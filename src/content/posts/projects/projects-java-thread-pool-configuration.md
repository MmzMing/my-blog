---
title: JAVA线程池配置指南
published: 2026-05-07
description: Java ThreadPoolExecutor 核心参数、线程数估算、队列选型与拒绝策略，附带企业级监控与动态调优方案。
tags: [Java, 线程池, 并发编程]
category: 学习文档
draft: false
---


> 本文面向需要在生产环境配置 Java 线程池的开发者。核心目标：将 `ThreadPoolExecutor` 的七个参数、任务调度流程、CPU/IO 场景差异、线程数估算方法、队列选型原则、监控指标与动态调优方案整理为可执行的工程规范。重点审查项：线程数是否受下游资源约束、拒绝策略是否可观测、容器环境是否正确读取 CPU 核数。

## 一、核心摘要

- **问题**：手动创建线程存在资源失控、创建开销大、缺乏背压与降级机制三类风险。
- **方案**：使用 `ThreadPoolExecutor` 显式配置核心线程数、最大线程数、队列、拒绝策略与线程工厂，并通过监控指标闭环调优。
- **关键约束**：`corePoolSize` 不应超过下游最小连接池容量；必须使用有界队列；拒绝策略必须可观测。
- **目标**：读完本文后，能够针对 CPU 密集、IO 密集、混合型三种业务场景给出初始配置，并设计压测与监控方案。

---

## 二、为什么需要线程池

手动为每个请求创建线程，存在以下三类问题：

| 问题 | 具体表现 | 后果 |
| --- | --- | --- |
| 资源失控 | 每个线程默认约 1MB 栈空间（`-Xss` 可配置），1000 个并发请求约占用 1GB 堆外内存 | 突发流量下触发 OOM |
| 创建开销 | 线程创建涉及 JVM 栈分配、OS 内核态切换，单次约 10~50μs | 高频创建时 CPU 与延迟显著上升 |
| 管理缺失 | 无法限制并发上限、无法感知任务积压、无法优雅降级 | 故障时缺乏控制手段 |

线程池提供的核心能力：

1. **线程复用**：降低线程创建与销毁开销。
2. **有界队列**：提供背压机制，防止无限堆积。
3. **拒绝策略**：在容量耗尽时执行降级或告警。

---

## 三、ThreadPoolExecutor 核心参数

`ThreadPoolExecutor` 的构造函数包含七个参数，必须整体理解：

```java
new ThreadPoolExecutor(
    corePoolSize,                         // 1. 核心线程数
    maximumPoolSize,                      // 2. 最大线程数
    keepAliveTime,                        // 3. 非核心线程空闲存活时间
    TimeUnit.SECONDS,                     // 4. 时间单位
    new LinkedBlockingQueue<>(1000),      // 5. 工作队列
    new NamedThreadFactory("order-exec"), // 6. 线程工厂
    new ThreadPoolExecutor.CallerRunsPolicy() // 7. 拒绝策略
);
```

### 1、corePoolSize 与 maximumPoolSize

| 参数 | 含义 | 行为 |
| --- | --- | --- |
| `corePoolSize` | 长期保活的核心线程数 | 即使空闲，默认也不回收（除非调用 `allowCoreThreadTimeOut(true)`） |
| `maximumPoolSize` | 线程池允许创建的最大线程数 | 仅在工作队列满后才会扩张到此值 |

两种典型策略：

- **固定大小**：`corePoolSize = maximumPoolSize`。无弹性，依赖队列缓冲流量波动。
- **弹性伸缩**：`corePoolSize < maximumPoolSize`。队列满后扩容，空闲线程超时回收。

### 2、keepAliveTime 与 TimeUnit

- 控制非核心线程的空闲回收时间。
- 建议值 30~120 秒。过短导致线程频繁创建销毁，引起 CPU 抖动；过长导致资源闲置。

### 3、工作队列

队列类型决定排队行为与弹性空间，必须与线程数一起决策。详见第六章。

### 4、线程工厂

生产环境必须自定义线程工厂，原因：

- `jstack` 或 arthas 排查时，`"pool-1-thread-1"` 无法判断业务归属；
- 命名清晰的线程（如 `"order-exec-1"`）可快速定位问题线程池。

```java
public class CustomThreadFactory implements ThreadFactory {
    private final String prefix;
    private final AtomicInteger counter = new AtomicInteger(1);

    public CustomThreadFactory(String prefix) {
        this.prefix = prefix;
    }

    @Override
    public Thread newThread(Runnable r) {
        Thread t = new Thread(r, prefix + "-" + counter.getAndIncrement());
        t.setDaemon(false);
        t.setUncaughtExceptionHandler((thread, ex) ->
            log.error("线程 {} 发生未捕获异常", thread.getName(), ex));
        return t;
    }
}
```

### 5、拒绝策略

当工作队列满且线程数达到 `maximumPoolSize` 时，新任务触发拒绝策略：

| 策略 | 行为 | 适用场景 | 风险 |
| --- | --- | --- | --- |
| `AbortPolicy`（默认） | 抛出 `RejectedExecutionException` | 核心链路，必须让调用方感知拒绝 | 调用方需捕获异常 |
| `CallerRunsPolicy` | 由提交线程自身执行 | 不能丢任务，天然限流 | 可能阻塞调用线程 |
| `DiscardPolicy` | 静默丢弃 | 可幂等重试的非关键任务 | 无感知数据丢失，生产慎用 |
| `DiscardOldestPolicy` | 丢弃队头最老任务 | 实时性优先，允许淘汰旧请求 | 老请求静默失败 |

**生产建议**：优先实现自定义拒绝策略，记录指标、触发告警、执行降级。

---

## 四、任务提交与执行流程

```mermaid
flowchart TD
    A[提交任务]
    A --> B{当前线程数 < corePoolSize?}
    B -->|是| C[创建核心线程并执行]
    B -->|否| D[将任务放入工作队列]
    D --> E{工作队列是否已满?}
    E -->|否| F[任务在队列中等待]
    E -->|是| G{当前线程数 < maximumPoolSize?}
    G -->|是| H[创建非核心线程并执行]
    G -->|否| I[触发拒绝策略]

```

**关键认知**：只有工作队列满了，线程池才会创建非核心线程。若使用无界队列，`maximumPoolSize` 永远不会生效。

---

## 五、CPU 密集型与 IO 密集型任务

线程池大小最核心的决策依据是**阻塞比（W/C）**，即等待时间与计算时间的比值。

### 1、CPU 密集型

**典型场景**：加密解密、数据压缩、图像处理、复杂排序、JSON 序列化。

- 线程大部分时间占用 CPU 执行指令。
- 阻塞比 W/C 约等于 0。
- 线程切换是纯损耗，不会提升吞吐。
- **线程数建议**：`N_cpu + 1`。

### 2、IO 密集型

**典型场景**：数据库查询、HTTP 远程调用、文件读写、消息队列消费。

- 线程大量时间处于 IO 等待状态。
- 阻塞比 W/C 可达几倍到几十倍。
- CPU 空闲期间可调度更多线程，提升资源利用率。
- **线程数建议**：根据 Goetz 公式估算，并受下游连接池约束。

### 3、混合型任务

典型 Web 请求链路示例：

| 阶段 | 类型 | 耗时占比（示例） |
| --- | --- | --- |
| 接受 HTTP 请求 | 网络 IO | 约 5% |
| 参数校验 / 反序列化 | CPU | 约 5% |
| 查询数据库 | IO 等待 | 约 70% |
| 业务规则计算 | CPU | 约 10% |
| 写 Redis 缓存 | IO | 约 10% |

混合场景应分段分析，或通过压测统计整体阻塞比，避免直接套用单一公式。

---

## 六、线程数估算方法

### 1、Little's Law

系统稳态下的基本关系：

```text
平均并发数 L = 到达率 λ × 平均响应时间 W
```

推导出线程数下界：

```text
N_threads ≥ λ × T_response
```

**示例**：峰值 QPS = 500，平均 RT = 200ms = 0.2s，则最低需要 `500 × 0.2 = 100` 个并发线程维持吞吐。

### 2、Brian Goetz 公式

出处：《Java 并发编程实战》

```text
N_threads = N_cpu × U_cpu × (1 + W/C)
```

| 参数 | 含义 | 获取方式 |
| --- | --- | --- |
| `N_cpu` | CPU 核心数 | `Runtime.getRuntime().availableProcessors()` |
| `U_cpu` | 目标 CPU 利用率 | 建议 0.7~0.85，预留余量给 GC / OS / 其他进程 |
| `W/C` | 等待时间 / 计算时间 | Profiler 或 APM 统计 |

**示例**：8 核机器，目标利用率 80%，IO 等待 200ms，计算 20ms。

- W/C = 200 / 20 = 10
- N = 8 × 0.8 × (1 + 10) = 70.4，取 **72**

### 3、公式的局限

1. **阻塞比难以准确测量**：不同流量时段、不同数据量下差异巨大，单次测量值可能误导。
2. **忽略下游瓶颈**：数据库连接池上限 50 时，设 200 个线程只会造成大量线程等待连接，反而劣化延迟。
3. **假设任务同质**：同一池处理轻量查询与重量报表时，平均 W/C 失去意义。

### 4、估算流程

```text
1. 用 Goetz 公式或 Little's Law 得出理论初始值
2. 对比下游资源上限（DB 连接池、HTTP 连接池），取较小值
3. 结合机器内存校验：线程数 × 1MB（默认栈）不超过可用堆外内存的 50%
4. 以该值作为压测起点，做阶梯加压验证
```

### 5、常见场景参考值

| 场景 | corePoolSize | maximumPoolSize | 说明 |
| --- | --- | --- | --- |
| CPU 密集 | `N_cpu + 1` | `N_cpu + 1` | +1 防止偶发 IO 阻塞 |
| IO 密集（DB 为主） | `min(N_cpu × 10, DB 连接池)` | core × 1.2 | 严格受下游约束 |
| IO 密集（HTTP 为主） | `N_cpu × (1 + W/C)` | core × 1.5 | W/C 需实测 |
| 混合型 Web | 实测后取 10~20× 核数 | core × 1.25 | 务必压测验证 |
| 定时任务 / 批处理 | 2~`N_cpu` | core × 2 | 避免与业务线程池竞争 |

---

## 七、工作队列选型

| 队列类型 | 容量 | 行为特征 | 适配场景 | 配套线程数策略 |
| --- | --- | --- | --- | --- |
| `LinkedBlockingQueue(n)` | 有界 | FIFO，满时触发拒绝策略 | 通用业务，需要背压 | core = max = N，队列缓冲突发 |
| `SynchronousQueue` | 0 | 无缓冲，提交必须立即有线程接收 | 高吞吐低延迟 | max 较大，`newCachedThreadPool` 底层 |
| `ArrayBlockingQueue(n)` | 有界，数组实现 | 内存局部性好，容量固定 | 严格控制内存 | core 小，max 大，队列满才扩容 |
| `PriorityBlockingQueue` | 无界 | 按优先级出队 | 任务有优先级差异 | 必须控制提交速率 |
| `DelayQueue` | 无界 | 到期才出队 | 延迟任务、定时重试 | core = max = 固定小值 |

**生产红线**：禁止使用 `Executors.newFixedThreadPool()` 与 `Executors.newCachedThreadPool()`。

- `newFixedThreadPool` 使用无界 `LinkedBlockingQueue`，任务堆积可导致 OOM。
- `newCachedThreadPool` 的 `maximumPoolSize` 为 `Integer.MAX_VALUE`，突发流量下线程数失控。

---

## 八、常见反模式

### 1、全局共用一个线程池

核心链路与非核心链路共享线程池时，非核心任务突发会挤占核心任务资源。

```java
// 错误：所有任务共用
@Bean("globalExecutor")
ThreadPoolExecutor global() { ... }

// 正确：按业务隔离
@Bean("paymentExecutor")   // 核心链路
ThreadPoolExecutor payment() { ... }

@Bean("logExecutor")       // 非核心，允许丢弃
ThreadPoolExecutor log() { ... }
```

### 2、不考虑下游限制盲目设大

下游 MySQL 连接池上限 50 时，设 500 个线程会导致 450 个线程空等连接，增加上下文切换与排队延迟。

**正确做法**：`corePoolSize ≤ 下游最小连接池上限`。

### 3、keepAliveTime 设置过短

流量波动场景下，`keepAliveTime` 过短（如 1 秒）会导致非核心线程频繁创建销毁，造成 CPU 与内存抖动。

**正确做法**：建议 30~120 秒。

### 4、任务中嵌套提交任务

```java
// 危险：父任务等待子任务，子任务无法入队 → 死锁
executor.submit(() -> {
    Future<?> child = executor.submit(() -> { /* 子任务 */ });
    child.get();
});
```

**正确做法**：使用 `ForkJoinPool` 处理父子依赖任务，或为子任务使用独立线程池。

### 5、容器环境不修正 CPU 核数

Docker 容器限制 2 核时，旧版 JDK 的 `Runtime.getRuntime().availableProcessors()` 可能返回宿主机 32 核，导致线程数虚高。

```java
// 问题版本
int cores = Runtime.getRuntime().availableProcessors();

// 安全版本：读取容器 CPU 配额
private int getCpuCores() {
    String cpuLimit = System.getenv("CPU_LIMIT");
    if (cpuLimit != null) return Integer.parseInt(cpuLimit);

    try {
        Path quotaPath = Paths.get("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
        Path periodPath = Paths.get("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
        long quota = Long.parseLong(Files.readString(quotaPath).trim());
        long period = Long.parseLong(Files.readString(periodPath).trim());
        if (quota > 0) return (int) Math.ceil((double) quota / period);
    } catch (Exception ignored) {}

    return Runtime.getRuntime().availableProcessors();
}
```

### 6、线程未命名

`jstack` 中 `"pool-1-thread-1"` 无法判断业务归属，应使用 `"order-exec-1"` 等命名。

---

## 九、企业级配置案例

### 1、需求分析清单

配置线程池前必须明确：

1. 峰值 QPS、平均 RT、P99 RT 是多少？
2. 任务是否存在外部依赖？下游连接池上限是多少？
3. SLA 要求：能否丢任务？允许多大延迟？
4. 容器 / Pod 分配的 CPU 核数是多少？

### 2、订单查询服务配置示例

**场景**：8 核 Pod，DB 查询 60ms，本地计算 5ms，W/C ≈ 12，目标 CPU 利用率 80%，DB 连接池上限 50。

**计算过程**：

```text
Goetz 公式：8 × 0.8 × (1 + 12) = 83.2 → 取 84
约束检查：DB 连接池上限 50 → 线程数不应超过 50
内存检查：50 × 1MB = 50MB，在 2GB Pod 内可接受

最终决策：
  corePoolSize    = 50
  maximumPoolSize = 60
  queue           = LinkedBlockingQueue(300)
  keepAliveTime   = 60 秒
  拒绝策略         = 自定义（记录指标 + 抛异常）
```

**代码实现**：

```java
@Bean("orderExecutor")
public ThreadPoolExecutor orderExecutor() {
    int cores = Runtime.getRuntime().availableProcessors();
    int effectiveCores = Math.min(cores, Integer.parseInt(
        System.getenv().getOrDefault("CPU_LIMIT", String.valueOf(cores))));

    int dbPoolSize = 50;
    int coreSize = Math.min(effectiveCores * 10, dbPoolSize);
    int maxSize = (int) (coreSize * 1.2);
    int queueCap = coreSize * 6;

    ThreadPoolExecutor executor = new ThreadPoolExecutor(
        coreSize, maxSize,
        60L, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(queueCap),
        new CustomThreadFactory("order-exec"),
        new MetricsRejectedHandler("order")
    );
    executor.allowCoreThreadTimeOut(false);
    return executor;
}
```

**自定义拒绝处理器**：

```java
public class MetricsRejectedHandler implements RejectedExecutionHandler {
    private final String poolName;

    public MetricsRejectedHandler(String poolName) {
        this.poolName = poolName;
    }

    @Override
    public void rejectedExecution(Runnable r, ThreadPoolExecutor e) {
        Metrics.counter("threadpool.rejected", "pool", poolName).increment();
        log.error("[{}] 任务被拒绝，队列积压:{} 活跃线程:{} 最大线程:{}",
            poolName, e.getQueue().size(), e.getActiveCount(), e.getMaximumPoolSize());
        throw new RejectedExecutionException("Pool " + poolName + " is saturated");
    }
}
```

### 3、压测验证方案

阶梯加压节奏：

```text
10 并发  → 稳定 2 分钟 → 记录基准
50 并发  → 稳定 2 分钟 → 记录吞吐 / RT / 队列深度
100 并发 → 稳定 2 分钟 → 观察是否积压
150 并发 → 稳定 2 分钟 → 观察 P99 劣化点
200 并发 → 稳定 2 分钟 → 寻找拒绝临界点
```

压测期间重点采集：

```java
pool.getActiveCount();          // 当前活跃线程数
pool.getQueue().size();         // 排队任务数
pool.getCompletedTaskCount();   // 已完成任务总数
pool.getLargestPoolSize();      // 历史最大线程数
pool.getTaskCount();            // 提交的总任务数
```

---

## 十、动态线程池

### 1、动态调整原理

`ThreadPoolExecutor` 支持运行时修改核心参数：

```java
executor.setCorePoolSize(newCoreSize);
executor.setMaximumPoolSize(newMaxSize);
```

结合 Apollo / Nacos 配置中心可实现秒级热更新。

### 2、实现示例

```java
@Component
public class DynamicThreadPoolManager {

    @Autowired
    private ThreadPoolExecutor orderExecutor;

    @NacosConfigListener(dataId = "thread-pool-config", groupId = "DEFAULT_GROUP")
    public void onConfigChange(String configJson) {
        ThreadPoolConfig cfg = JSON.parseObject(configJson, ThreadPoolConfig.class);

        int newCore = cfg.getCoreSize();
        int newMax = cfg.getMaxSize();

        // 扩大时先改 max，缩小时先改 core
        if (newCore > orderExecutor.getMaximumPoolSize()) {
            orderExecutor.setMaximumPoolSize(newMax);
            orderExecutor.setCorePoolSize(newCore);
        } else {
            orderExecutor.setCorePoolSize(newCore);
            orderExecutor.setMaximumPoolSize(newMax);
        }

        log.info("线程池动态调整完成 pool=order core={} max={}", newCore, newMax);
    }
}
```

### 3、队列容量动态修改

标准 `BlockingQueue` 容量在构造时固定。如需动态队列，可选：

1. **自实现 `ResizableLinkedBlockingQueue`**：重写 `capacity` setter，加锁保证并发安全。
2. **开源方案**：
   - **dynamic-tp**（京东开源）：支持参数热更新、监控、告警一体化。
   - **Hippo4j**（美团团队维护）：企业级动态线程池框架，支持多注册中心。

---

## 十一、可观测性：监控与告警

### 1、Prometheus 指标暴露

```java
public static void registerToPrometheus(ThreadPoolExecutor pool, String name) {
    MeterRegistry registry = Metrics.globalRegistry;

    Gauge.builder("threadpool.active", pool, ThreadPoolExecutor::getActiveCount)
         .tag("pool", name).description("活跃线程数").register(registry);

    Gauge.builder("threadpool.pool_size", pool, ThreadPoolExecutor::getPoolSize)
         .tag("pool", name).description("当前线程总数").register(registry);

    Gauge.builder("threadpool.queue_size", pool, p -> p.getQueue().size())
         .tag("pool", name).description("队列积压任务数").register(registry);

    Gauge.builder("threadpool.utilization", pool,
             p -> (double) p.getActiveCount() / p.getCorePoolSize())
         .tag("pool", name).description("核心线程利用率").register(registry);

    Gauge.builder("threadpool.largest_pool_size", pool, ThreadPoolExecutor::getLargestPoolSize)
         .tag("pool", name).description("历史最大线程数").register(registry);
}
```

### 2、AlertManager 告警规则

```yaml
groups:
  - name: threadpool_alerts
    rules:
      - alert: ThreadPoolHighUtilization
        expr: threadpool_utilization > 0.85
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "线程池 {{ $labels.pool }} 利用率超过 85%"

      - alert: ThreadPoolQueueBacklog
        expr: threadpool_queue_size / threadpool_queue_capacity > 0.7
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "线程池 {{ $labels.pool }} 队列积压超过 70%"

      - alert: ThreadPoolRejection
        expr: increase(threadpool_rejected_total[1m]) > 0
        for: 0m
        labels:
          severity: critical
        annotations:
          summary: "线程池 {{ $labels.pool }} 出现任务拒绝"

      - alert: ThreadPoolMaxSizeReached
        expr: threadpool_pool_size >= threadpool_max_size
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "线程池 {{ $labels.pool }} 线程数触达最大值，持续 3 分钟"
```

### 3、告警阈值参考

| 指标 | Warning | Critical | 含义 |
| --- | --- | --- | --- |
| 活跃线程 / 核心线程数 | > 80% | > 95% | 线程饱和，即将排队 |
| 队列积压量 | > 队列容量 50% | > 80% | 消费跟不上，延迟上涨 |
| 被拒绝任务数（1 分钟） | > 0 | > 10 | 系统过载 |
| 线程数触达 maximumPoolSize | 持续 1 分钟 | 持续 5 分钟 | 需要扩容或限流 |

---

## 十二、性能调优建议

### 1、线程数调优

- **初始值**：使用 Goetz 公式或历史 QPS/RT 数据估算。
- **约束校验**：确保 `corePoolSize ≤ min(DB 连接池, HTTP 连接池, 内存可承载线程数)`。
- **压测验证**：以阶梯加压找到吞吐拐点，将 `corePoolSize` 设置在拐点并发量的 70%~80%。
- **动态调整**：流量波动明显的服务接入动态线程池。

### 2、队列深度调优

- 队列容量不宜过大：过大会隐藏延迟问题，导致 P99 劣化。
- 经验公式：`queueCapacity = corePoolSize × 平均 RT（秒） × 安全系数（2~3）`。
- 需要背压的场景使用有界队列，拒绝策略选择 `CallerRunsPolicy` 或自定义策略。

### 3、GC 与内存调优

- 关注线程栈内存占用：默认 1MB/线程，可通过 `-Xss` 调整。
- 高频创建/销毁线程会增加 Native Memory 分配压力，尽量复用线程。
- 容器环境开启 `-XX:+UseContainerSupport`（JDK 8u191+）。

### 4、上下文切换调优

- 当 `cs（上下文切换次数）/ 任务数` 持续升高时，说明线程数过多。
- 使用 `vmstat`、`pidstat -w` 监控上下文切换频率。
- 在线程饱和前扩容机器或优化任务计算逻辑。

---

## 十三、常见问题解答（FAQ）

### 1、Q1：`corePoolSize` 和 `maximumPoolSize` 应该设成一样吗？

**A**：不一定。固定大小（core = max）适合负载稳定的场景，实现简单；弹性伸缩（core < max）适合流量波动大、需要应对突发的场景。生产环境更推荐后者，配合有界队列使用。

### 2、Q2：为什么线程池达到了 `maximumPoolSize` 但 CPU 使用率仍然很低？

**A**：可能原因：

1. 线程大部分时间阻塞在 IO 等待，CPU 未被有效利用；
2. 下游服务（数据库、缓存、HTTP 接口）成为瓶颈；
3. 锁竞争严重，线程实际并行度不足。

应通过 APM 或 Profiler 定位具体阻塞点，而不是简单增加线程数。

### 3、Q3：任务被拒绝时应该选择哪种策略？

**A**：核心链路推荐 `AbortPolicy` 或自定义策略（记录指标 + 抛异常），让调用方感知并降级；非核心但不可丢任务的场景可选 `CallerRunsPolicy`；可丢弃的非关键任务可选 `DiscardPolicy` 或 `DiscardOldestPolicy`。

### 4、Q4：使用 `CompletableFuture` 时如何指定自定义线程池？

**A**：`CompletableFuture` 默认使用 `ForkJoinPool.commonPool()`，可能不适合业务场景。应显式传入：

```java
CompletableFuture.supplyAsync(() -> fetchOrder(orderId), orderExecutor)
    .thenApplyAsync(this::enrichOrder, orderExecutor);
```

### 5、Q5：Spring 的 `@Async` 默认线程池有什么问题？

**A**：Spring 默认使用 `SimpleAsyncTaskExecutor`，每次任务都新建线程，且队列无界。生产环境应通过 `ThreadPoolTaskExecutor` 自定义：

```java
@Bean("taskExecutor")
public ThreadPoolTaskExecutor taskExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(16);
    executor.setMaxPoolSize(32);
    executor.setQueueCapacity(200);
    executor.setThreadNamePrefix("async-");
    executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    executor.initialize();
    return executor;
}
```

### 6、Q6：如何优雅关闭线程池？

**A**：使用 `shutdown()` + `awaitTermination()` 组合：

```java
executor.shutdown();
try {
    if (!executor.awaitTermination(60, TimeUnit.SECONDS)) {
        executor.shutdownNow();
    }
} catch (InterruptedException e) {
    executor.shutdownNow();
    Thread.currentThread().interrupt();
}
```

### 7、Q7：`allowCoreThreadTimeOut(true)` 是否推荐？

**A**：适合流量波动极大的场景，可在低峰期回收核心线程节省资源。但会增加高峰期线程创建开销，核心链路建议保持默认 `false`。

---

## 十四、决策速查表

| 场景 | corePoolSize | maximumPoolSize | 队列 | 拒绝策略 |
| --- | --- | --- | --- | --- |
| CPU 密集 | `N_cpu + 1` | `N_cpu + 1` | 有界或小容量 | `AbortPolicy` |
| IO 密集（有下游限制） | `min(公式值, 下游连接池)` | core × 1.2 | 有界 | 自定义 + 指标 |
| 高吞吐低延迟 | `N_cpu × 2` | 较大 | `SynchronousQueue` | `CallerRunsPolicy` |
| 批处理 / 定时任务 | 2~`N_cpu` | core × 2 | 有界 | `CallerRunsPolicy` |
| 混合型 Web | 实测后 10~20× 核数 | core × 1.25 | 有界 | 自定义 + 指标 |

---

## 十五、总结

1. **永远不用 `Executors` 工厂方法**，必须显式构造 `ThreadPoolExecutor`。
2. **必须使用有界队列**，无界队列是 OOM 隐患。
3. **corePoolSize 不超过下游最小连接池**，这是物理约束。
4. **拒绝策略必须可观测**，静默丢弃在生产环境等于数据黑洞。
5. **暴露监控指标并设置告警**，线程池问题不能靠感觉发现。

合理工程流程：

```mermaid
flowchart LR
    A[公式估算] --> B[约束校验] --> C[压测验证] --> D[监控落地] --> E[动态调整]
```

---

## 十六、参考资料

- 《Java 并发编程实战》Brian Goetz
- 阿里巴巴《Java 开发手册》
- [dynamic-tp](https://github.com/dromara/dynamic-tp)
- [Hippo4j](https://github.com/opengoofy/hippo4j)
