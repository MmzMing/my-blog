---
title: Java 枚举策略模式：用枚举替换 if-else 分发的三种绑定方式
image: ./assets/details-java-enum-strategy-pattern.webp
published: 2026-09-13
description: 用 Java 枚举承接按类型分发行为的 if-else 链：时间单位偏移与数据收集服务分发两个案例，覆盖三种绑定形式的选择与 ordinal 落库等高频坑。
tags: [Java, 设计模式, 枚举]
category: 学习文档
draft: false
---

> [!NOTE] 提示
> 本文解决日常开发中最常见的分支失控问题：按类型分发行为。案例取自项目里重构过的两段真实代码：时间单位枚举 `TimeUnitEnum`（抽象方法版）与数据收集分发枚举 `DataCollectEnum`（服务接口 + Optional 版）。重点审查项：查找走静态表且失败路径显式、枚举策略无状态、需要依赖注入的场景改用 Spring 策略 Map。

## 核心摘要

- **问题**：类型定义、映射关系、算法实现散在同一个方法里，单位 code 是散落的字符串常量，拼错和漏匹配只能运行期暴露。
- **方案**：用枚举承载「类型 → 行为」映射，按行为依赖什么选三种绑定形式。
- **边界**：枚举常量在类加载期初始化，拿不到 Spring bean；需要依赖注入或运行时扩展改用 Spring 策略 Map。
- **目标**：新增分支 = 加一个常量；漏实现 = 编译失败；未知 code 的失败路径显式可见。

## 引子

场景是调度系统按「间隔 + 单位」推算任务下次执行时间。配置存两个字段：`resubmitInterval` 和 `resubmitIntervalUnit`（SEC / MIN / HR / DAY）。第一版计算逻辑：

```java
public Date nextRunTime(Date requestedStartDate, Integer interval, String unit) {
    if ("SEC".equals(unit)) {
        return DateUtil.offsetSecond(requestedStartDate, interval);
    } else if ("MIN".equals(unit)) {
        return DateUtil.offsetMinute(requestedStartDate, interval);
    } else if ("HR".equals(unit)) {
        return DateUtil.offsetHour(requestedStartDate, interval);
    } else if ("DAY".equals(unit)) {
        return DateUtil.offsetDay(requestedStartDate, interval);
    }
    return requestedStartDate;
}
```

`"SEC"` 字符串散落在每个计算点，拼错没有编译错误，漏匹配静默返回原时间；加时间、减时间、间隔校验各复制一份单位判断；新增单位要改所有老方法。项目实际的重构结果是下文的 `TimeUnitEnum`：类型定义、映射关系、算法实现收进一个枚举，新增分支等于新增一个常量。

## 背景知识

1. 枚举常量是进程级单例，由类加载机制创建（JLS §8.9）。
2. 枚举可以声明抽象方法，每个常量在定义处覆写，漏实现直接编译失败。
3. 时间偏移用 hutool 的 `DateUtil`（项目既有依赖）。

## 核心内容

### 第一步：行为搬进常量（抽象方法版）

MINUTE、HOUR 与 SECOND 同构（`offsetMinute` / `offsetHour`），此处省略，组装完成的完整成品见下文「实战演示一」：

```java
public enum TimeUnitEnum {

    SECOND("SEC", "秒") {
        @Override
        public Date addTime(Date date, Integer interval) {
            return DateUtil.offsetSecond(date, interval);
        }

        @Override
        public Date subTime(Date date, Integer interval) {
            return DateUtil.offsetSecond(date, -interval);
        }
    },
    MINUTE("MIN", "分钟") { /* 同构，省略 */ },
    HOUR("HR", "小时") { /* 同构，省略 */ },
    DAY("DAY", "天") {
        @Override
        public Date addTime(Date date, Integer interval) {
            return DateUtil.offsetDay(date, interval);
        }

        @Override
        public Date subTime(Date date, Integer interval) {
            return DateUtil.offsetDay(date, -interval);
        }
    };

    private final String code;
    private final String info;

    TimeUnitEnum(String code, String info) {
        this.code = code;
        this.info = info;
    }

    /** 加 / 减 interval 个当前单位。 */
    public abstract Date addTime(Date date, Integer interval);
    public abstract Date subTime(Date date, Integer interval);

    // getCode() / getInfo() 从略
}
```

```java
Date nextDay = TimeUnitEnum.DAY.addTime(horizonDay.getDateTo(), stockLt.intValue());
```

### 三种绑定形式

| 形式 | 适用条件 | 案例 |
| --- | --- | --- |
| 字段绑数据 | 分支差异只是配置值 | 单位秒数换算系数 |
| 抽象方法绑行为 | 逻辑纯计算，只依赖入参 | `addTime` / `subTime`（案例一） |
| 服务作参数 | 逻辑要调 Spring bean，调用方传入 | `execute(DataCollectService, ctx)`（案例二） |

字段绑数据的例子：分支差异只是数据时，一个换算系数字段就够，不必覆写方法：

```java
SECOND("SEC", "秒", 1L),
MINUTE("MIN", "分钟", 60L),
HOUR("HR", "小时", 3600L),
DAY("DAY", "天", 86400L);

private final long seconds;

/** 间隔归一化为秒，用于跨单位比较。 */
public long toSeconds(long interval) {
    return interval * seconds;
}
```

三种形式可混合使用：能用同一算法骨架表达就用字段，分支不同构才覆写，需要容器里的 bean 就把服务作为方法参数传入（案例二），枚举类加载期不依赖容器。

### 静态查找表：从线性扫描到静态 Map

项目初版的查找方法：

```java
public static TimeUnitEnum getEnumByCode(String code) {
    for (TimeUnitEnum item : values()) {
        if (item.getCode().equals(code)) {
            return item;
        }
    }
    return TimeUnitEnum.DAY;
}
```

两个问题：每次调用克隆数组再线性扫描，O(n)；未知 code 静默返回 `DAY`，传错单位被按天重排且不留痕，上层补偿分支永远走不到。

改进版：

```java
private static final Map<String, TimeUnitEnum> CODE_MAP = Arrays.stream(values())
        .collect(Collectors.toMap(TimeUnitEnum::getCode, Function.identity()));

/** fail fast：脏配置拦在入口。 */
public static TimeUnitEnum getEnumByCode(String code) {
    TimeUnitEnum unit = CODE_MAP.get(code);
    if (unit == null) {
        throw new IllegalArgumentException("未知时间单位 code: " + code);
    }
    return unit;
}

/** 允许降级的场景单独走可空查找，决策留在调用方。 */
public static TimeUnitEnum findOrNull(String code) {
    return CODE_MAP.get(code);
}
```

失败路径三选一，全站保持一致：fail fast（对外接口）、Optional / 可空（允许跳过的批处理，见案例二）、默认值兜底（默认值必须经业务确认，代价是上层错误处理变成死代码，见案例一）。

### 与 Spring 策略模式的选型边界

枚举常量在类加载期初始化，早于容器启动，构造器里拿不到任何 bean。

| 维度 | 枚举策略 | Spring Map 策略（`Map<String, Handler>` 注入） |
| --- | --- | --- |
| 分支数量 | 编译期固定 | 运行时可扩展，新 bean 自动注册 |
| 依赖注入 | 不支持，只能由调用方传入 | 天然支持 |
| 分支完整性 | 编译器强制，漏写编译失败 | 无强制，漏注册运行期才暴露 |
| 状态 | 必须无状态 | Handler 可以有状态、可配置 |
| 序列化与落库 | code 可直接映射字典表 | 需自行维护 key 约定 |
| 适用规模 | 十几个分支以内、逻辑稳定 | 分支持续增长、逻辑重、需要 mock 单依赖 |

分支不超过十几个、逻辑纯计算，用枚举；需要多依赖协作或预期持续膨胀，用 Spring 策略。

## 实战演示一：时间单位偏移

核心内容一节按「行为搬进常量」「三种绑定形式」「静态查找表」分步拆解了模式本身，这一节把三步组装成项目里落地的完整成品。先看最终的 `TimeUnitEnum`，四个常量全部展开，落库与报文反序列化的注解一并标上：

```java
public enum TimeUnitEnum {

    SECOND("SEC", "秒") {
        @Override
        public Date addTime(Date date, Integer interval) {
            return DateUtil.offsetSecond(date, interval);
        }

        @Override
        public Date subTime(Date date, Integer interval) {
            return DateUtil.offsetSecond(date, -interval);
        }
    },
    MINUTE("MIN", "分钟") {
        @Override
        public Date addTime(Date date, Integer interval) {
            return DateUtil.offsetMinute(date, interval);
        }

        @Override
        public Date subTime(Date date, Integer interval) {
            return DateUtil.offsetMinute(date, -interval);
        }
    },
    HOUR("HR", "小时") {
        @Override
        public Date addTime(Date date, Integer interval) {
            return DateUtil.offsetHour(date, interval);
        }

        @Override
        public Date subTime(Date date, Integer interval) {
            return DateUtil.offsetHour(date, -interval);
        }
    },
    DAY("DAY", "天") {
        @Override
        public Date addTime(Date date, Integer interval) {
            return DateUtil.offsetDay(date, interval);
        }

        @Override
        public Date subTime(Date date, Integer interval) {
            return DateUtil.offsetDay(date, -interval);
        }
    };

    /** 实体字段声明为枚举类型时，MyBatis-Plus 按此字段的值读写数据库列。 */
    @EnumValue
    private final String code;
    private final String info;

    TimeUnitEnum(String code, String info) {
        this.code = code;
        this.info = info;
    }

    public String getCode() {
        return code;
    }

    public String getInfo() {
        return info;
    }

    /** 加 / 减 interval 个当前单位。 */
    public abstract Date addTime(Date date, Integer interval);
    public abstract Date subTime(Date date, Integer interval);

    private static final Map<String, TimeUnitEnum> CODE_MAP = Arrays.stream(values())
            .collect(Collectors.toMap(TimeUnitEnum::getCode, Function.identity()));

    /** fail fast：脏配置拦在入口。 */
    @JsonCreator
    public static TimeUnitEnum getEnumByCode(String code) {
        TimeUnitEnum unit = CODE_MAP.get(code);
        if (unit == null) {
            throw new IllegalArgumentException("未知时间单位 code: " + code);
        }
        return unit;
    }

    /** 允许降级的场景单独走可空查找，决策留在调用方。 */
    public static TimeUnitEnum findOrNull(String code) {
        return CODE_MAP.get(code);
    }
}
```

两个注解打通枚举与外部数据：`@EnumValue` 让实体上的 `TimeUnitEnum` 字段与存 code 的数据库列直接互转；`@JsonCreator` 让报文里的 `"SEC"`、`"MIN"` 反序列化时走同一条「查表 + fail fast」路径，脏 code 在入口就被拦下。

枚举之上再包一层 `MyDateUtils`，调用方面对的是普通静态方法，不必感知分派细节，参数已是枚举、方法体就是纯委托：

```java
public static Date addDate(Date sourceDate, Integer timeInterval, TimeUnitEnum unitEnum) {
    return unitEnum.addTime(sourceDate, timeInterval);
}

public static Date subDate(Date sourceDate, Integer timeInterval, TimeUnitEnum unitEnum) {
    return unitEnum.subTime(sourceDate, timeInterval);
}
```

调用点分两类。**单位在编码期已知**的，直接传常量，写错编译不过：

```java
Date nextDay = MyDateUtils.addDate(horizonDay.getDateTo(), stockLt.intValue(), TimeUnitEnum.DAY);
```

**单位来自数据库字符串**的，先过查找表再计算，失败路径就地显式处理：写回备注留痕、跳过本条，批内其他任务不受影响：

```java
private void copyOne(ScpConcurrentRequestsVO maxDateRequest) {
    Date newDate;
    try {
        newDate = MyDateUtils.addDate(
                maxDateRequest.getRequestedStartDate(),
                maxDateRequest.getResubmitInterval(),
                TimeUnitEnum.getEnumByCode(maxDateRequest.getResubmitIntervalUnit()));
    } catch (IllegalArgumentException e) {
        maxDateRequest.setCompletionComments("时间类型错误: " + maxDateRequest.getResubmitIntervalUnit());
        remoteScpMasterControlService.updateById(maxDateRequest);
        return;
    }
    // ... 后续复制逻辑
}
```

单测锁定两个行为：加减互逆覆盖全部常量（`@EnumSource` 遍历 `values()`，新增常量自动纳入），未知 code 确实 fail fast：

```java
@ParameterizedTest
@EnumSource(TimeUnitEnum.class)
void addThenSubRestoresOriginalTime(TimeUnitEnum unit) {
    Date base = new Date(1700000000000L);
    Date restored = MyDateUtils.subDate(MyDateUtils.addDate(base, 5, unit), 5, unit);
    assertEquals(base, restored);
}

@Test
void unknownCodeFailsFast() {
    assertThatThrownBy(() -> TimeUnitEnum.getEnumByCode("WEEK"))
            .isInstanceOf(IllegalArgumentException.class);
}
```

对照引子的痛点逐一收口：单位字符串只在枚举定义处出现一次；新增单位等于加一个常量、覆写两个方法，所有调用点不动，漏覆写编译失败；未知 code 在查找入口显式抛错，不再静默按天重排。

## 实战演示二：服务分发（接口 + Optional）

场景：数据收集平台，一个入口按 `collectCode` 分发收集动作，动作实现在业务服务里。

```java
public interface DataCollectService {
    void collectMaterial(CollectContext ctx);
    void collectOrder(CollectContext ctx);
    void collectItems(CollectContext ctx);
}
```

```java
@Getter
public enum DataCollectEnum {

    MATERIAL("MATERIAL", "同步物料") {
        @Override
        public void execute(DataCollectService service, CollectContext ctx) {
            service.collectMaterial(ctx);
        }
    },
    ORDER("ORDER", "同步订单") {
        @Override
        public void execute(DataCollectService service, CollectContext ctx) {
            service.collectOrder(ctx);
        }
    },
    ITEM("ITEM", "ITEM 数据收集") {
        @Override
        public void execute(DataCollectService service, CollectContext ctx) {
            service.collectItems(ctx);
        }
    };

    private final String code;
    private final String name;

    DataCollectEnum(String code, String name) {
        this.code = code;
        this.name = name;
    }

    /** 统一操作入口，service 由调用方传入。 */
    public abstract void execute(DataCollectService service, CollectContext ctx);

    private static final Map<String, DataCollectEnum> CODE_MAP = Arrays.stream(values())
            .collect(Collectors.toMap(DataCollectEnum::getCode, Function.identity()));

    /** Optional 版查找：未知 code 返回 empty，跳过还是报错由调用方决定。 */
    public static Optional<DataCollectEnum> getByCode(String code) {
        return Optional.ofNullable(CODE_MAP.get(code));
    }

    public static String getNameByCode(String code) {
        return getByCode(code).map(DataCollectEnum::getName).orElse("");
    }
}
```

两条关键设计：

1. **参数类型声明为接口**。用 `<T extends DataCollectService>` 约束泛型也行；直接声明实现类类型，常量体里就要强转，`((实际服务类) service)` 这类写法就是这么来的。
2. **未知 code 走 Optional**。`collectCode` 是运营配置，未知时跳过并记日志，比抛异常温和；两个案例正好覆盖两种失败路径。

控制器一行完成分发：

```java
@GetMapping("/collect")
public R collect(@RequestParam String collectCode, CollectContext ctx) {
    DataCollectEnum.getByCode(collectCode)
            .ifPresent(e -> e.execute(dataCollectService, ctx));
    return R.ok();
}
```

服务接口的实现端可以是任何 bean；控制器自身实现了接口时，传 `this` 同样成立。业务参数超过三个时收成参数对象（`CollectContext`），别让 `execute` 的签名跟着业务字段膨胀。

## 踩坑点 & 注意事项

### 坑 1：ordinal() 落库

插入新常量会让后续所有序号位移，已落库数据语义静默错位。落库用显式 `code` 字段，`ordinal()` 只限同枚举内部使用。

### 坑 2：构造期引用静态查找表

枚举常量先于其他静态字段初始化，构造路径读 `CODE_MAP` 拿到 null，编译通过、类加载期 NPE，堆栈只有一行 `<clinit>`。查找表只被静态方法读取，任何常量构造路径不碰它。

### 坑 3：常量里放可变状态

常量是进程级单例，可变字段被所有请求线程共享，压测时出现时对时错且难复现。枚举只放不可变字段（code、info、函数引用），请求级状态走方法参数。

### 坑 4：传统 switch 没有穷举检查

新增常量后传统 switch 静默走 default；switch 表达式（Java 14+）缺分支直接编译失败。分支调度优先用抽象方法，确需 switch 用表达式形式。

### 坑 5：删除或改名枚举值

数据库和报文里的老 code 不会消失，删常量后历史数据反序列化直接报错。枚举只增不删，废弃常量标 `@Deprecated` 保留映射。

## 性能/对比数据

| 方案 | 分支查找 | 新增分支改动点 | 漏实现的暴露时机 | 依赖注入 |
| --- | --- | --- | --- | --- |
| if-else 链 | O(n) | 改老方法 | Code review | 困难 |
| 传统 switch 语句 | O(1)，编译器生成跳转表 | 改老方法 | 运行期，静默走 default | 困难 |
| 枚举抽象方法 | O(1)，虚方法分派 | 加一个常量 | 编译期 | 不支持 |
| 枚举 + 静态 Map | O(1)，HashMap | 加一个常量 | 编译期或单测 | 不支持 |
| Spring Map 策略 | O(1)，HashMap | 加一个 bean | 启动后首次调用，或依赖单测 | 天然支持 |

初版 `getEnumByCode` 就是第一行的 O(n)：每次调用克隆常量数组再线性扫描，静态表消除分配并把查找降到 O(1)。枚举常量类加载期创建一次，请求路径无策略对象分配；Spring Handler 同为单例，选型差异在依赖注入与扩展性，不在性能。

## 总结

枚举策略把「类型 → 行为」映射交给编译器检查：类型定义、code 映射、算法收进一个枚举，新增分支只增常量，漏实现编译失败。两个案例覆盖两种接法：纯计算用抽象方法（`TimeUnitEnum`），依赖服务用接口参数（`DataCollectEnum`）；失败路径三选一并全站一致：fail fast、Optional、经业务确认的默认值。分支稳定逻辑轻用枚举，需要依赖注入或持续膨胀用 Spring Map 策略。

## 参考资料

- 《Effective Java（第 3 版）》Item 34：用枚举类型替代 int 常量（含常量特定方法实现与策略枚举模式）
- [Java Language Specification, §8.9 Enum Types](https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.9)
- [Oracle Java Tutorials: Enum Types](https://docs.oracle.com/javase/tutorial/java/javaOO/enum.html)
- [MyBatis-Plus 通用枚举（@EnumValue）](https://baomidou.com/guides/faq/#%E4%B8%BA%E4%BB%80%E4%B9%88%E8%87%AA%E5%AE%9A%E4%B9%89%E6%9E%9A%E4%B8%BE%E7%B1%BB%E5%9E%8B%E4%B8%8D%E7%94%9F%E6%95%88)

---

> [!NOTE] 提示
> 如果这篇文章对你有帮助，欢迎点赞收藏。有问题欢迎评论区交流。
