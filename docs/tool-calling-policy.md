# Tool Calling Policy (STM-first)

> 目标：让模型在每轮任务中稳定形成「先加载短期记忆，再产出，再回写记忆」的闭环。

## 一、调用时序（强约束）

1. **首轮调用 `memory_load`**（在响应用户前）
   - 用于加载当前会话/任务相关短期记忆（STM）
   - 若无命中，继续任务，不阻塞

2. **末轮调用 `memory_update`**（在本轮输出结束前）
   - 将本轮新增的关键上下文写回
   - 重点写入：决策、约束变更、待办变化、关键结论

---

## 二、STM 判据（3 轮复用原则）

若信息在未来 **3 轮** 内很可能被再次引用，则纳入 STM：

- 当前任务目标/范围
- 新确认的约束条件
- 待办项与状态变化（pending / done）
- 临时变量、参数、文件路径、报错栈
- 用户明确修正/改口（需求切换）

不满足则不强行写入，避免噪音。

---

## 三、建议工具定义（简化版）

## `memory_load`
**作用**：统一“看记忆”，用于当前轮开头加载上下文。

**建议入参**：
- `session_id`（可选，推荐）
- `date`（可选，默认今天）
- `limit`（可选，默认 20）
- `tags`（可选）
- `category`（可选）
- `query`（可选）
- `scope`（可选：`stm|all`，默认 `stm`）

**建议返回**：
- `items[]`（记忆条目）
- `summary`（可选摘要）
- `pending[]` / `done[]`（若可提取）

---

## `memory_update`
**作用**：统一“写记忆”，用于当前轮末尾回写。

**建议入参**：
- `session_id`（可选；无则自动生成并返回）
- `date`（可选，默认今天）
- `mode`：`append|upsert`（默认 `append`）
- `entry_type`：`decision|preference|knowledge|todo|state_change`
- `title`
- `content`
- `tags[]`
- `category`
- `importance`（1-5）

**建议返回**：
- `id`
- `session_id`
- `file_path`
- `created|updated`

---

## 四、并发与目录规范

为支持多个 CLI 同时写入，建议目录如下：

```text
memories/
  YYYY-MM-DD/
    <session_uuid>/
      2026-03-03T16-41-23.123Z-<slug>.md
```

说明：
- 同一天按 `session_uuid` 分桶，避免并发冲突
- 每条记录仍保留 YAML + Markdown 正文
- `session_uuid` 可来自调用方；缺省由服务端生成

---

## 五、触发更新条件

在以下事件发生时，优先触发 `memory_update`：

- 用户显式改需求（如“换个方案”）
- 任务状态切换（分析 → 实现 / 实现 → 验证）
- 新信息与既有 STM 冲突
- 本轮产出形成可复用结论

---

## 六、设计原则

- **STM 保留细节，不做过度抽象**
- **LTM 另层抽取，不与 STM 混存**
- **先 load，后 update，形成闭环**
