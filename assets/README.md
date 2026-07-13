# 赞助二维码（服务器托管）

支付宝打赏二维码 **不打包进插件**，由官网托管，插件联网校验后显示。

## 服务器文件

部署到 `https://www.linyilu.com/downloads/ima-sync/assets/`：

| 文件 | 说明 |
|------|------|
| `sponsor-alipay.png` | 支付宝收款码，建议 ≥400×400 PNG |
| `sponsor-alipay.md5` | 单行 32 位 MD5 十六进制（与 PNG 内容一致） |

## 本地准备（发版前）

1. 将 PNG 放到本目录：`assets/sponsor-alipay.png`
2. 运行 `npm run chronicle:bundle-ima-sync` → 自动生成 `assets/sponsor-alipay.md5`
3. 运行 `npm run tools:publish` → 同步到 `apps/web/public/downloads/ima-sync/assets/`
4. 部署网站

## 插件行为

1. 并行请求 PNG 与 MD5
2. 计算 PNG 的 MD5，与服务器 `.md5` 文件比对
3. **一致** → 显示二维码
4. **不一致 / 离线 / 缺失** → **不显示二维码**，显示两行：`联网显示二维码` / `临忆录`

插件内 **不读取** 本地 `assets/` 二维码，防止被替换。

完整 SOP 与复用说明：`docs/design/IMA插件-支付宝打赏防篡改.md`
