# IMA Sync · Analytics 独立租户

> Phase 3 · C3-04 · 与 wikimap Hub 协议兼容、实例可分离

---

## 1. 模型

| 层 | 说明 |
|----|------|
| 插件 | 默认开启 · 可关 · `lib/telemetry.js` · `client_channel` + 可选 `tenantId` · `ima.install` 例外始终一次 |
| 采集 | POST `analytics.defaultEventsUrl`（来自 `product-manifest.json`） |
| Hub | wikimap `scripts/ima-sync-analytics/` 或自建兼容端点 |

**硬依赖**：无。关闭遥测或留空 URL 时插件正常工作。

---

## 2. product-manifest 字段

```json
"analytics": {
  "defaultEventsUrl": "https://your-host/analytics/events",
  "clientChannel": "ima-sync-yourbrand",
  "tenantId": "your-instance-id",
  "optional": true
}
```

| 字段 | 用途 |
|------|------|
| `clientChannel` | 事件聚合维度（必填） |
| `tenantId` | 多实例 / 白标分离（推荐 fork 时修改） |
| `defaultEventsUrl` | 采集端点；fork 可换 host |
| `optional` | 非硬依赖；插件无 Analytics 仍可正常工作 |

---

## 3. 事件契约（摘要）

- Hook：`ima.install` · `ima.heartbeat` · `ima.sync` · `ima.feedback` 等
- Payload：**不含** API Key、笔记路径、正文
- 用户控制：反馈弹窗 → 匿名统计开关（默认开 · opt-out）
- `ima.install`：首次启用上报一次（版本/地域），与开关无关

完整字段见 wikimap `scripts/chronicle/obsidian-plugin/ima-sync/lib/telemetry.js`。

---

## 4. wikimap 默认实例 vs fork

| 实例 | tenantId 示例 | 说明 |
|------|---------------|------|
| 临忆录默认 | `linyilu-default` | ops-dashboard 可选 Tab |
| 独立产品 | `ima-sync-acme` | 自建 Hub 或禁用 |

同一 Hub 可按 `tenantId` + `client_channel` 分表展示；不共享运营数据。

---

## 5. 自建采集（最小）

1. 实现 POST `/analytics/events` 接收 JSON 事件数组
2. 校验 `client_channel` / `tenantId` 白名单
3. 在 manifest 写入 `defaultEventsUrl`
4. 插件侧 **默认开启**；用户可在反馈弹窗关闭；`ima.install` 仍会上报一次

wikimap 参考：`scripts/ima-sync-analytics/README.md`
