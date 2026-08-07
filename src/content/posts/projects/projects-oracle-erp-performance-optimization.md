---
title: Oracle ERP性能优化
published: 2025-12-02
description: 记录 Oracle ERP 因 SHRINK 导致聚簇因子恶化的排查过程，结合 AWR、执行计划、索引重建、在线表重定义和查询调优分析性能问题。
tags: [Oracle, 数据库, 性能优化]
category: 实践笔记
draft: false
---

> [!NOTE] 提示
> 本文记录一次 Oracle ERP 排产变慢的排查过程：表执行 SHRINK 后，索引与表的物理顺序关系发生变化，导致聚簇因子恶化和逻辑读增加。排查应以 AWR、执行计划和重建前后的指标为依据；本文数据来自单个业务场景，不能直接外推到所有表。


---

## 一、背景

DBA 对 MRP 相关表执行了 SHRINK 操作：

```sql
ALTER TABLE xxxxx ENABLE ROW MOVEMENT;       -- 允许行物理移动
ALTER TABLE xxxxx SHRINK SPACE COMPACT CASCADE; -- 压缩数据，不降高水位
ALTER TABLE xxxxx SHRINK SPACE CASCADE;      -- 降低高水位线（HWM）
ALTER TABLE xxxxx DISABLE ROW MOVEMENT;      -- 禁用行移动保护 ROWID
```

**目的：** 回收表碎片空间，降低高水位线（HWM）。  
**结果：** MRP 排产并发请求变慢，正式环境排产耗时超过 **50 分钟**。

---

## 二、根本原因：聚簇因子（Clustering Factor）恶化

### 1、什么是聚簇因子

聚簇因子衡量**索引键值顺序**与**表物理行存储顺序**的吻合程度。

| CF 范围 | 含义 | 对范围扫描的影响 |
|---|---|---|
| 接近**块数** | 行按索引顺序集中存储 | 快，顺序读 ✅ |
| 接近**行数** | 行分散在各个块 | 慢，随机读 ❌ |

记忆规则：**索引范围扫描 + 扫描行数多 + CF 大 → 需要访问的块越多 → 越慢**。

### 2、SHRINK 为什么会恶化 CF

SHRINK 在压缩数据时会物理移动行（ROWID 改变），导致行的存储顺序与索引键值顺序不再对应。原本顺序读 2 个块，移动后每行都可能落在不同块，索引范围扫描变成随机跳块读，CR 暴增。

### 3、恶化后的等待事件

| 等待事件 | 场景 | 原因 |
|---|---|---|
| `latch cache buffer chain` | 单节点 / RAC | 随机块访问过多，Buffer Get 过高，latch 成为瓶颈 |
| `GC buffer busy` | RAC 集群 | 跨节点传输散乱数据块，Global Cache 争用 |

### 4、聚簇因子检测

```sql
-- 先收集统计信息
EXEC dbms_stats.gather_index_stats(ownname => 'SCHEMA', indname => 'INDEX_NAME');

-- 查询 CF 异常索引（CF > 行数/2 且 CF > 块数）
SELECT *
  FROM (
    SELECT d.clustering_factor, d.table_name, d.index_name,
           d.num_rows, d.last_analyzed
      FROM dba_indexes d
     WHERE d.clustering_factor > d.num_rows / 2
       AND d.clustering_factor > (
             SELECT t.blocks FROM dba_tables t
              WHERE t.table_name = d.table_name
                AND t.owner = d.table_owner
           )
     ORDER BY 1 DESC
  )
 WHERE rownum <= 10;
```

---

## 三、分析方法

### 1、工具链

| 工具 | 用途 |
|---|---|
| `tkprof` | 解析 Trace 文件，输出各 SQL 的 CR、PR、执行次数、耗时 |
| AWR 报告 | Top SQL / Top Wait Events 全局视角 |
| SQL 执行计划 | 确认访问路径（INDEX RANGE SCAN、FULL SCAN 等）|
| `v$session_wait` | 实时等待事件观察 |

### 2、关键指标

| 指标 | 含义 |
|---|---|
| `cr` | Consistent Reads，逻辑读次数，越高说明扫描越多 |
| `pr` | Physical Reads，物理读，有 pr 说明数据未命中缓存 |
| `elapsed` | SQL 总耗时 |
| `executions` | 执行次数，高频低耗的 SQL 累计影响同样不可忽视 |

### 3、定位流程

```
AWR Top Wait Events
  → 发现 latch / GC buffer busy 占比高
    → AWR Top SQL by Buffer Gets 找 CR 最高的 SQL
      → tkprof 分析 Trace，确认执行次数 × CR 贡献最大的 SQL
        → 查执行计划，确认 INDEX RANGE SCAN + 高 CF 组合
          → 查 DBA 操作记录，SHRINK 时间与性能劣化吻合
            → 确认根因，制定优化方案
```

---

## 四、优化方案

### 1、在线表重定义（降低聚簇因子）

**核心原理：** 按特定索引键列顺序重建表的物理存储顺序，等效于：

```sql
CREATE TABLE new_table AS SELECT * FROM old_table ORDER BY <目标索引列>;
```

在线重定义（`DBMS_REDEFINITION`）可在不停业务的情况下完成；若允许停机维护，直接 CTAS + 重命名速度更快。

---

#### 1.1 BOM_COMPONENTS_B — 优化等级：🔴 高

**问题定位：**

```
文件 20640，1210 行，执行次数 1 次，SQL 执行时间 17 秒，返回 9418 行
INDEX RANGE SCAN BOM_COMPONENTS_B_N2 (cr=89869 pr=0 pw=0 time=320951 us cost=2 card=20)
```

**问题分析：**

- 执行仅 1 次，但 CR 高达 89,869，是最理想的重定义优化目标
- 问题索引 `BOM_COMPONENTS_B_N2` 仅含 `BILL_SEQUENCE_ID` 单列，选择性差
- 每次范围扫描都随机访问大量分散数据块

**相关索引：**

| 索引名 | 类型 | 列 |
|---|---|---|
| BOM_COMPONENTS_B_N1 | Normal | COMPONENT_ITEM_ID, BILL_SEQUENCE_ID, EFFECTIVITY_DATE |
| BOM_COMPONENTS_B_N2 | Normal | BILL_SEQUENCE_ID |
| BOM_COMPONENTS_B_N8 | Normal | BILL_SEQUENCE_ID, EFFECTIVITY_DATE, COMPONENT_ITEM_ID, OPERATION_SEQ_NUM |
| BOM_COMPONENTS_B_U2 | Unique | COMPONENT_SEQUENCE_ID |

**重定义策略：** 按 `COMPONENT_SEQUENCE_ID`（主键序列）排序重定义

> 主键按序列号写入，BILL_SEQUENCE_ID 也近似有序写入，聚簇因子随之显著下降。

---

#### 1.2 BOM_STRUCTURES_B — 优化等级：🔴 高

**问题定位：**

```
文件 20640，1208 行，执行次数 1 次，SQL 执行时间 17 秒，返回 9418 行
INDEX RANGE SCAN BOM_STRUCTURES_B_N2 (cr=9336 pr=0 pw=0 time=57158 us cost=2 card=1)
```

**问题分析：** 虽然是小表（约 25 万行），但一次范围扫描 CR 达 9,336，读取了全表近 1/5 的数据，聚簇严重失序。

**重定义策略：** 按 U1 主键顺序（`OBJ_NAME, PK1_VALUE, PK2_VALUE, ALTERNATE_BOM_DESIGNATOR`）重定义

> 不按 N2 索引列（ASSEMBLY_ITEM_ID, ORGANIZATION_ID）排序，原因：为优化单个索引而改变物理顺序会导致其他索引效率下降；按主键排序是恢复数据到自然写入状态的最优平衡。

---

#### 1.3 MRP_SCHEDULE_DATES — 优化等级：🟡 低

```
INDEX RANGE SCAN MRP_SCHEDULE_DATES_N3 (cr=2300 pr=45 time=291062 us)
INDEX RANGE SCAN MRP_SCHEDULE_DATES_N3 (cr=5598 pr=0  time=486020 us)
```

**说明：** 由于业务存在频繁增删（详见 5.1 节），重定义效果会随运行时间持续退化，N3 索引聚簇甚至反而有所上升，非根治方案。

**重定义顺序：** `MPS_TRANSACTION_ID, SCHEDULE_LEVEL, SUPPLY_DEMAND_TYPE`（U1 主键）

---

#### 1.4 MRP_SOURCING_HISTORY — 优化等级：🟡 低

```
INDEX RANGE SCAN MRP_SOURCING_HISTORY_N1 (cr=3 pr=0 time=17 us cost=3 card=1)
```

**说明：** 索引选择性极好（每次仅读 3 个块），上榜原因是 SQL 执行次数较多（16,309 次），重定义收益有限，已改用修改 INITRANS 方案（详见 4.3 节）。

---

#### 1.5 MRP_SYSTEM_ITEMS — 优化等级：🔴 高

```
INDEX RANGE SCAN MRP_SYSTEM_ITEMS_N1 (cr=2684 pr=0 time=22149 us cost=71 card=14577)
执行次数：147,556
```

**重定义顺序：** `ORGANIZATION_ID, COMPILE_DESIGNATOR, INVENTORY_ITEM_ID`（U1 唯一索引）

**效果：** 聚簇因子有明显降低。

---

#### 1.6 MTL_ITEM_REVISIONS_B — 优化等级：⚫ 非常低

```
INDEX RANGE SCAN MTL_ITEM_REVISIONS_B_N1 (cr=9773142 pr=0 time=10366045 us cost=3 card=1)
执行次数：9,523,591
```

**结论：** N1 聚簇降低不明显，重定义收益小于风险，暂不推荐。

---

#### 1.7 MTL_ITEM_REVISIONS_TL — 优化等级：🔴 高

```
INDEX UNIQUE SCAN MTL_ITEM_REVISIONS_TL_U1 (cr=7279966 pr=0 time=7849002 us cost=1 card=1)
执行次数：9,523,591
```

**特殊说明：** 已缓存进 Keep Pool，但聚簇因子仍偏高，重定义后聚簇降低明显，进一步减少内存命中时的 latch 争用。

**重定义顺序：** `INVENTORY_ITEM_ID, ORGANIZATION_ID, REVISION_ID, LANGUAGE`（U1 主键）

---

#### 1.8 MTL_SYSTEM_ITEMS_B — 优化等级：🟡 低

```
INDEX UNIQUE SCAN MTL_SYSTEM_ITEMS_B_U1 (cr=485300 pr=0 time=333503 us cost=2 card=1)
执行次数：294,088
```

**结论：** U1 聚簇降低不明显，且 N1、N2 索引聚簇有上升趋势，重定义反而可能劣化。

---

#### 1.9 RCV_SHIPMENT_LINES — 优化等级：⚫ 非常低

```
INDEX RANGE SCAN RCV_SHIPMENT_LINES_N1 (cr=4 pr=0 time=13 us cost=3 card=71)
执行次数：约 14,000+
```

**结论：** 单次范围扫描块数极低（cr=4），执行慢主因是次数多。重定义后 N1 聚簇从 0.7 降为 0.05，但实测第一次执行时间反而有所上升，性价比低。

---

### 2、修改索引

#### 2.1 RCV_TRANSACTIONS 添加新索引

**高频关联 SQL：**

```sql
SELECT rct.transaction_type      trans_type,
       rct.transaction_id        trans_id,
       rct.parent_transaction_id parent_trans_id,
       rct.primary_quantity      trans_qty
  FROM rcv_shipment_lines rsl,
       rcv_transactions   rct
 WHERE rct.source_document_code = 'PO'
   AND rsl.item_id = :b3
   AND rct.shipment_line_id = rsl.shipment_line_id
   AND rct.transaction_type = 'DELIVER'
   AND rct.transaction_date BETWEEN :b2 AND :b1
   AND EXISTS (SELECT 1
                 FROM po_headers_all poh
                WHERE rsl.po_header_id = poh.po_header_id
                  AND nvl(poh.vendor_site_id, -99) = nvl(:b5, -99)
                  AND poh.vendor_id = :b4
                  AND rownum = 1)
```

**统计信息：**

```
Execute  16309    0.14      0.15      0       42         0       0
Fetch    16309   23.44     27.19     46  12044152        0       0
```

**优化效果：**

| 操作 | 执行时间 |
|---|---|
| 优化前 | 100 秒 |
| 添加 RCV_TRANSACTIONS 新索引后 | 18 秒 |
| 进一步将视图改为基表 MTL_ITEM_REVISIONS_B | 5 秒 |

---

### 3、修改存储参数（MRP_SOURCING_HISTORY）

**背景：** mrp_get_sourcing_history 存储过程执行 16,309 次，每次为自治事务，包含频繁的增删操作。

```sql
-- 备份原始参数
-- ALTER TABLE MRP.MRP_SOURCING_HISTORY PCTFREE 10;
-- ALTER TABLE MRP.MRP_SOURCING_HISTORY INITRANS 1;
-- ALTER INDEX MRP.MRP_SOURCING_HISTORY_N1 INITRANS 11;

-- 执行优化
ALTER TABLE MRP.MRP_SOURCING_HISTORY PCTFREE 0;        -- 原 10
ALTER TABLE MRP.MRP_SOURCING_HISTORY INITRANS 20;       -- 原 1
ALTER INDEX MRP.MRP_SOURCING_HISTORY_N1 INITRANS 20;    -- 原 11
```

**参数说明：**

- **PCTFREE 0：** 不预留块内更新空间，同等行数占用块数更少，范围扫描需访问的块数减少。该表存储过程内无 UPDATE 操作，设为 0 安全。
- **INITRANS 20：** 提高事务槽数量，支持更多并发事务同时修改同一数据块，避免默认值 1/11 在高并发写入时的块级 latch 争用。

---

### 4、核心表缓存至 Keep Pool

**操作：** 将 2 个核心高频全表扫描的表（合计约 1.2 GB）固定缓存至 Keep Buffer Pool（保留池）。

**Keep Pool 大小设置：** 直接设置为 **10 GB**（标准建议为段大小的 2 倍，考虑 UNDO 影响，为未来类似需求预留充裕空间）。

**效果：** 第二次执行时，Snapshot Monitor 从缓存读取，耗时降低约 **50%**。

**Keep Pool 优势：**
- 命中率极高，碎片极少（运行良好的保留池无频繁页入页出）
- 避免大表全表扫描将共享池中其他 SQL 解析缓存刷出
- 在 RAC 环境下减少跨节点 GC 传输

---

## 五、深度分析

### 1、MRP_SCHEDULE_DATES 频繁增删导致聚簇持续退化

**问题现象：** 每次 MRP 排产对 MRP_SCHEDULE_DATES 执行大批量 DELETE + INSERT（schedule_level=3 数据全量删除重建），每批次限 75,000 行循环执行。

**核心 SQL：**

```sql
-- DELETE 操作
DELETE FROM mrp_schedule_dates
 WHERE schedule_level = 3
   AND (schedule_designator, organization_id) IN (
         SELECT input_designator_name, input_organization_id
           FROM mrp_plan_schedules_v
          WHERE organization_id = :b0
            AND compile_designator = :b1
            AND input_designator_type = 1
       )
   AND rownum <= :b2;

-- INSERT 操作（紧随其后）
INSERT INTO mrp_schedule_dates (
  inventory_item_id, reference_schedule_id, organization_id,
  schedule_designator, schedule_level, ...
)
SELECT inventory_item_id, reference_schedule_id, organization_id,
       schedule_designator, 3, ...
  FROM mrp_schedule_dates
 WHERE schedule_level = 2
   AND supply_demand_type = 1
   AND (organization_id, schedule_designator) IN (
         SELECT input_organization_id, input_designator_name
           FROM mrp_plan_schedules_v
          WHERE organization_id = :b2
            AND compile_designator = :b3
            AND input_designator_type = 1
       );
```

**根因：** 频繁增删彻底破坏行的物理有序性，重定义只能是临时手段。

**建议方向：**
- 业务层面使用 TRUNCATE PARTITION（若表已分区）替代批量 DELETE
- 减少中间临时数据的写入量
- 评估是否可将 schedule_level=3 的数据改为内存计算，不落库

---

### 2、SQL 高频执行累计消耗大

**相关 SQL：**

```sql
SELECT RCT.TRANSACTION_TYPE  TRANS_TYPE,
       RCT.TRANSACTION_ID    TRANS_ID,
       RCT.PARENT_TRANSACTION_ID PARENT_TRANS_ID,
       RCT.PRIMARY_QUANTITY  TRANS_QTY
  FROM RCV_SHIPMENT_LINES RSL,
       RCV_TRANSACTIONS   RCT
 WHERE RCT.SOURCE_DOCUMENT_CODE = 'PO'
   AND RSL.ITEM_ID = :B3
   AND RCT.SHIPMENT_LINE_ID = RSL.SHIPMENT_LINE_ID
   AND RCT.TRANSACTION_TYPE = 'DELIVER'
   AND RCT.TRANSACTION_DATE BETWEEN :B2 AND :B1
   AND EXISTS (
         SELECT 1 FROM PO_HEADERS_ALL POH
          WHERE RSL.PO_HEADER_ID = POH.PO_HEADER_ID
            AND NVL(POH.VENDOR_SITE_ID, -99) = NVL(:B5, -99)
            AND POH.VENDOR_ID = :B4
            AND ROWNUM = 1
       )
```

**性能数据：**

```
Fetch    16309   23.44     27.19     46    12044152      0       0
```

**问题分析：**

- 单次执行快（毫秒级），但执行 **16,309 次**，累计 CPU 时间 23 秒，Elapsed 27 秒
- `NVL(POH.VENDOR_SITE_ID, -99)` 函数包裹导致 vendor_site_id 列的索引完全失效
- EXISTS 子查询每次均需全量扫描 PO_HEADERS_ALL

**建议改写：**

```sql
-- 将 NVL 函数改为等效的条件判断，使 vendor_site_id 索引可用
AND (
  (POH.VENDOR_SITE_ID = :B5 AND :B5 IS NOT NULL)
  OR (POH.VENDOR_SITE_ID IS NULL AND :B5 IS NULL)
)
```

或为 `NVL(VENDOR_SITE_ID, -99)` 创建函数索引：

```sql
CREATE INDEX PO_HEADERS_ALL_FN1 ON PO_HEADERS_ALL (NVL(VENDOR_SITE_ID, -99), VENDOR_ID);
```

---

### 3、自治事务频繁提交导致 log file sync 等待

**统计信息：**

```
Execute  16309    30.16     34.79     46   12120936    166836    16309

等待事件：
  log file sync    Waited: 16309    Max.Wait: 0.32    Total Waited: 70.09
```

**根因：** mrp_get_sourcing_history 使用 `PRAGMA AUTONOMOUS_TRANSACTION`（自治事务），每次调用均独立提交。16,309 次调用即产生 16,309 次 COMMIT，每次 COMMIT 强制 LGWR 将 Redo Buffer 刷入在线重做日志，前台进程挂起等待（log file sync），累计等待 **70 秒**。

**Oracle Redo 刷新触发条件：**

| 触发条件 | 说明 |
|---|---|
| Redo Buffer 超过 1/3 或 1 MB | LGWR 自动后台刷新 |
| DBWn 写脏块前 | 约 3 秒超时，强制刷新 |
| **COMMIT 调用** | **无条件立即刷新，前台进程挂起等待** |

**类比说明：**

> 把 Redo Buffer 比作水桶，本来是接了三分之一水才往外倒；现在每插入一行就发一次"快倒水"的命令，相当于每接一杯水就强制倒一次，效率极低。前台进程必须等 LGWR 倒完才能继续，这段等待就是 log file sync。

**日志组状态（v$log）：**

| Group | Sequence | Status |
|---|---|---|
| 2 | 1001 | ACTIVE（日志已写磁盘，但 Buffer Cache 脏块尚未全部写入数据文件）|
| 3 | 1002 | CURRENT（正在接收 Redo 写入）|
| 4 | 1003 | INACTIVE（已完成检查点）|

**最优提交频率估算：**

- 若每 1,000 行 INSERT 产生约 1 MB Redo → 最优提交间隔 ≥ 每 1,000 行一次
- 若循环处理 100 行需 3 秒 → 最优提交间隔 ≥ 每 100 行一次（避免超过 3 秒后台刷新触发时 Redo 浪费）

**建议方案：** 修改存储过程逻辑，改为批量操作后统一提交，或缩短自治事务使用范围（仅对真正需要独立提交的操作使用自治事务）。

**注意：** 长时不提交的代价是 UNDO 维护量增大，严重时导致 ORA-01555（快照太旧）。需根据业务场景权衡提交间隔。

---

### 4、视图替代基表导致全表扫描

**问题 SQL（执行一次耗时 57 秒）：**

```sql
SELECT MAX(rev.revision), items.inventory_item_id, items.organization_id
  FROM mtl_item_revisions       rev,   -- ← 此处为视图，含 TL 多语言表 JOIN
       mrp_system_items         items,
       mrp_plan_organizations_v mpo
 WHERE trunc(rev.effectivity_date) = (
         SELECT trunc(MAX(rev2.effectivity_date))
           FROM mtl_item_revisions rev2   -- ← 相关子查询自关联
          WHERE rev2.implementation_date IS NOT NULL
            AND rev2.effectivity_date <= (trunc(SYSDATE) + .99999)
            AND rev2.organization_id = rev.organization_id
            AND rev2.inventory_item_id = rev.inventory_item_id
       )
   AND rev.organization_id = items.organization_id
   AND rev.inventory_item_id = items.inventory_item_id
   AND items.organization_id = mpo.planned_organization
   AND items.compile_designator = mpo.compile_designator
   AND mpo.organization_id = :b0
   AND mpo.compile_designator = :b1
 GROUP BY items.inventory_item_id, items.organization_id
```

**执行统计：**

```
Fetch    1477     54.64     57.21    30019   26034502     28    147556
                                    ↑ 物理读 30,019 块，CR 超 2,600 万
```

**性能对比：**

| SQL 版本 | 执行时间 |
|---|---|
| 使用视图 mtl_item_revisions | 约 57 秒 |
| 使用基表 MTL_ITEM_REVISIONS_B | 约 11 秒（降至原来约 1/5）|

**根因：** `mtl_item_revisions` 是包含多语言（TL）表 JOIN 的视图，查询时额外关联 MTL_ITEM_REVISIONS_TL，大幅增加数据量和 JOIN 操作，且相关子查询存在自关联，优化器难以有效处理。

**阻碍：** 该 SQL 位于 Oracle EBS 标准 Package（源代码不可直接修改），需通过以下方式解决：

- 申请 Oracle Support Patch
- 联系 Oracle 客服提交 SR
- 使用 Oracle Application 的个性化开发机制（若有）

---

## 六、优化效果汇总

| 优化手段 | 涉及对象 | 优化等级 | 状态 | 核心收益 |
|---|---|:---:|:---:|---|
| 在线表重定义 | BOM_COMPONENTS_B | 🔴 高 | ✅ 已完成 | CR 89,869 → 大幅降低 |
| 在线表重定义 | BOM_STRUCTURES_B | 🔴 高 | ✅ 已完成 | 小表读 1/5 问题解决 |
| 在线表重定义 | MRP_SYSTEM_ITEMS | 🔴 高 | ✅ 已完成 | 聚簇明显降低 |
| 在线表重定义 | MTL_ITEM_REVISIONS_TL | 🔴 高 | ✅ 已完成 | 9.5M 次唯一扫描 CR 大幅下降 |
| 在线表重定义 | MRP_SCHEDULE_DATES | 🟡 低 | ✅ 已完成 | 效果随时间退化，非根治方案 |
| 在线表重定义 | RCV_SHIPMENT_LINES | ⚫ 非常低 | ✅ 已完成 | 收益极有限，首次反而略慢 |
| 添加/修改索引 | RCV_TRANSACTIONS | 🔴 高 | ✅ 已完成 | 100s → 18s；改用基表后 → 5s |
| 修改存储参数 | MRP_SOURCING_HISTORY | 🟡 中 | ✅ 已完成 | PCTFREE 10→0；INITRANS 提升至 20 |
| Keep Pool 缓存 | 核心全扫表（1.2GB）| 🔴 高 | ✅ 已完成 | Snapshot Monitor 耗时降约 50% |
| SQL 改写（基表替换视图）| mtl_item_revisions | 🔴 高 | ⏳ 待解决 | 可降至 1/5 时间，需修改 EBS 标准包 |
| 减少自治事务提交频率 | mrp_get_sourcing_history | 🔴 高 | ⏳ 待解决 | log file sync 等待 70s 可消除 |
| MRP_SCHEDULE_DATES 架构优化 | MRP 增删逻辑 | 🟡 中 | ⏳ 待解决 | 根治聚簇退化问题 |
| SQL 改写（NVL 函数索引失效）| PO_HEADERS_ALL | 🟡 中 | ⏳ 待解决 | 高频 SQL 索引可用性提升 |

---

## 七、MRP 性能优化扩展框架

基于 Oracle Support 官方调优指南（Doc 100956.1 / 100964.1），结合本次优化实践，整理完整优化框架如下：

### 1、数据库基础资源层

| 检查项 | 说明 | 本次涉及 |
|---|---|:---:|
| 物理内存是否充足 | SGA/PGA 配置 | — |
| 日志组数量和大小 | log file sync 等待是否成为瓶颈 | ✅ |
| Redo Buffer 空间 | 空间不足导致重做竞争（`redo log space requests`） | — |
| UNDO 表空间磁盘分离 | 与数据文件在同一磁盘会产生 I/O 竞争 | — |
| SSD vs 机械硬盘 | SSD 无寻道延迟，适合随机 I/O 密集场景 | — |
| PGA 排序区 | 多趟排序（`sort disk`）表明 PGA 不足，可提高 `PGA_AGGREGATE_TARGET` | — |

### 2、缓存与共享池层

| 检查项 | 说明 | 本次涉及 |
|---|---|:---:|
| Buffer Cache 命中率 | < 95% 需扩大 Buffer Cache | — |
| Keep Pool 配置 | 固定热点小表，防止被全扫大表刷出 | ✅ |
| 共享池碎片 | 大量游标解析导致共享池碎片化 | — |
| 库缓存（Library Cache）命中率 | 使用绑定变量，减少硬解析 | — |
| 数据字典缓存命中率 | `V$ROWCACHE` 中 GETS/MISSES 比 | — |
| DBWR 进程数 | 脏块写入速度跟不上时增加 `DB_WRITER_PROCESSES` | — |

### 3、索引与表设计层

| 检查项 | 说明 | 本次涉及 |
|---|---|:---:|
| 聚簇因子（CF） | 索引范围扫描核心指标，重点关注 | ✅ |
| 行链接与行迁移 | PCTFREE 不足或行变大导致，影响读取效率 | — |
| 统计信息准确性 | 过期统计信息导致错误执行计划 | ✅（部分）|
| 表分区与索引分区 | 大表分区可显著降低 DML 和扫描代价 | — |
| 列组统计信息 | 多列联合过滤时，单列统计不准，需创建列组统计 | — |
| 高水位（HWM） | 有全表扫描时需关注；无全表扫描则影响有限 | ✅（已通过重定义降低）|

### 4、SQL 执行计划层

| 检查项 | 说明 | 本次涉及 |
|---|---|:---:|
| 函数包裹导致索引失效 | NVL、TO_CHAR 等包裹索引列时索引无法使用 | ✅ |
| 绑定变量窥视（Bind Peeking） | 绑定变量数据倾斜时可能生成错误执行计划 | — |
| 视图展开 | 视图内包含多余 JOIN 时阻止合理优化 | ✅ |
| 相关子查询转换 | 相关子查询往往可改写为 JOIN 提升效率 | — |
| 执行次数 × 单次耗时 | 高频低耗 SQL 累计影响同样不可忽视 | ✅ |

### 5、并发与事务层

| 检查项 | 说明 | 本次涉及 |
|---|---|:---:|
| INITRANS 事务槽不足 | 并发 DML 同一块时产生等待 | ✅ |
| 自治事务提交频率 | 每次提交均触发 LGWR 刷盘 | ✅ |
| RAC GC 等待 | 跨节点数据块传输开销 | ✅ |
| 锁争用 | 行锁、表锁分析 | — |

### 6、应用配置层

| 检查项 | 说明 | 本次涉及 |
|---|---|:---:|
| BOM 深度和大小 | BOM 层级越深，低层码计算越耗时 | — |
| 并发管理器配置 | Worker 数量与服务器核数匹配 | — |
| 是否安装最新补丁 | Oracle EBS 补丁包含已知性能修复 | — |
| SQL*Net 网络带宽 | 非瓶颈则不需特别关注 | — |

---

## 八、总结

### 1、项目一句话定位

Oracle EBS MRP 核心排产链路性能优化，从 50 分钟降至可接受范围，核心手段是通过 Trace/AWR 定位根因后综合运用表重定义、索引优化、Redo 调优和 Keep Pool。

### 2、逻辑链（这是整个项目的叙事骨架）

```
DBA 执行 SHRINK
  → 行物理移动，存储顺序打乱
    → Clustering Factor 急剧升高
      → Index Range Scan 变随机读
        → CR 暴增，latch / GC buffer busy 等待
          → MRP 排产从正常水平劣化到 50 分钟
            → 通过重定义恢复行顺序 → CF 下降 → CR 下降 → 性能恢复
```

这条链讲清楚了，整个项目的技术深度就到位了。面试时不管从哪个环节问，都能顺着链条向前和向后延伸。

### 3、几个值得强调的细节

**重定义为什么按主键排序而不是按业务索引排序。** 按业务索引排序只优化那一个索引的 CF，其他索引会变差；按主键排序是恢复数据自然写入状态，是全局最优平衡。

**CF 高不一定要处理。** 判断标准是实际 CR，不是 CF 绝对值。没有范围扫描，或者扫描行数极少，CF 高也可以不管。

**log file sync 的本质。** 不是 IO 慢，而是提交太频繁，把异步的 LGWR 刷盘变成了同步等待。解法是减少提交次数，不是加快磁盘。

**MRP_SCHEDULE_DATES 是未根治的遗留问题。** 重定义只是治标，业务频繁增删会让 CF 持续退化。这个问题如果被追问，说明面试官在考察你对优化局限性的认知，诚实讲清楚比硬撑更好。

**PCTFREE 改为 0 的前提一定要说清楚。** 必须确认表没有 UPDATE 操作才能改，否则行更新扩行会导致行迁移（Row Migration），反而劣化性能。这个细节体现了操作严谨性。

---

## 九、参考资料

| 文档 | 说明 |
|---|---|
| [Oracle Support Doc 100956.1](https://support.oracle.com/epmos/faces/DocumentDisplay?id=100956.1) | MRP Core/Mfg 性能调优及故障处理指南 |
| [Oracle Support Doc 100964.1](https://support.oracle.com/epmos/faces/DocumentDisplay?id=100964.1) | 数据库和 Core/MFG MRP 相关性能问题排查 |
| [Oracle Support Doc 223603.1](https://support.oracle.com/epmos/faces/DocumentDisplay?id=223603.1) | MRP 性能优化扩展参考 |
| [Oracle Support Doc 836809.1](https://support.oracle.com/epmos/faces/DocumentDisplay?id=836809.1) | MRP 相关补丁及解决方案 |
| [Oracle Support Doc 1931325.1](https://support.oracle.com/epmos/faces/DocumentDisplay?id=1931325.1) | MRP 性能问题 CAUSE 分析 |
| [Oracle MRP 官方文档](https://docs.oracle.com/cd/A60725_05/html/comnls/us/mrp/ipc.htm) | Oracle MRP 架构示意图 |

---

*报告整理于 Oracle EBS MRP 优化实践文档，适用于 Oracle Database 11g/12c/19c + RAC 环境。*
