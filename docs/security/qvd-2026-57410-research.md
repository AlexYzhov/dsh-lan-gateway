# QVD-2026-57410 上游研究

核查日期：2026-09-06。范围仅为公开通告、上游发布与鉴权变更；未审计本地插件，未执行 PoC，未访问运行中服务或凭据。以下“已核实”指已读取一手发布或代码记录，不代表完成漏洞复现或修复验收。

## 结论

- **已核实上游加入统一浏览器鉴权。** 本次确认最早包含该变更及相关后续修正的发布为 `0.1.2-alpha.1`，标签 `dsh-v0.1.2-alpha.1`，发布时间为 **2026-08-27 17:06:37 UTC**，即北京时间 8 月 28 日。发布说明明确列出“网络访问 Web 界面时启用链接中的一次性 token 认证鉴权”。`0.1.2-rc.1` 的发布说明也明确包含此项；两者均标记为预发布。[发布记录][release-alpha]、[RC 发布记录][release-rc]、[发布 API][releases-api]
- **不能将其写成“官方确认 QVD-2026-57410 已完全修复”。** 已读取的发布说明及鉴权设计未明确关联此 QVD 编号；本次查询官方仓库公开安全通告 API 返回空列表。可确认的是对应“缺少身份认证、信任 Host 头”的加固已发布，不是所有相关攻击链均已验证消除。[安全通告 API][security-api]
- **受影响版本仅按报告归属陈述。** 原始研究者在上游 Discussion #853 声称复现 `@deepseek-ai/dsh@0.1.0-rc.6`；其“所有 0.x RC”属于推测，不能扩写为已核实范围。协调方已读取的 HackSpeak 报告及本次读取的中文转载均报告 `0.1.1-rc.2`。本研究没有独立复现这些版本。[研究者报告][discussion]、[HackSpeak][hackspeak]、[中文转载][reprint]

## 上游提交与实现边界

1. 初始提交 [`3e24087bfaeabe40b58ba2f7b936895b8f93fe27`][auth-commit]，标题 `fix(web): authenticate the browser Host API`，提交时间 2026-08-25 UTC。它将原先依据 loopback Host 头的特权判断改为 Host API 分发前统一浏览器鉴权。
2. 后续提交包括 `ce031ddd1696d95b4602292f0a7caa589a7dd776`（运行环境覆盖）、`3b3b493a9607a2cbbebd3b01b89c8b328d15edeb`（热重载保留启动令牌）、`5595d593d123e17390bc357b7e7ebb02b9b0110a`（鉴权契约文档）及 [`9c964848cd54d6e9a7d5f01f1745936673cd1910`][sync-commit]（同步认证）。[官方文件提交历史][auth-history] 可查完整链条；[比较 API][compare-api] 返回 `status: ahead`、`behind_by: 0`，且 merge base 为 `9c964848...`，确认 alpha.1 包含整条变更链，不能只摘初始提交当作完整升级方案。
3. [alpha.1 标签下的官方设计说明][auth-design] 明确：Host/Origin 校验与身份认证分离；API、RPC、Remote HTTP 和 WebSocket 等网络调用要求浏览器会话，信任校验失败返回 403，缺少有效会话返回 401。根页面通过启动 URL 令牌换取绑定 hostname/port 的签名 Cookie；API 不直接接受该令牌或 `Authorization` 头中的令牌。非 index 静态资源仍公开。
4. 同一说明也明确：Cookie 默认有效期 30 天，可跨重启；使用 `HttpOnly`、`SameSite=Strict`，但 loopback HTTP 不设置 `Secure`。删除签名记录后需要重启才能全局撤销，不能依据初始提交误写成即时撤销。CLI 仍拒绝 `--host 0.0.0.0`；此鉴权变更**不意味着官方支持网络部署、TLS 或反向代理**。持有 Cookie 即可调用完整工具型 Host API，并非细粒度多用户授权。

## 原始通告与讨论的证据等级

- **奇安信原始通告：未核实。** 本次检索 `ti.qianxin.com`、`qianxin.com` 的编号和产品名未定位到对应官方正文。中文转载称奇安信于 2026-08-24 披露、评分 9.8、编号 QVD-2026-57410，但转载末尾原文来源是微信公众号“杂杂咱谈”，不是奇安信。故上述披露日期、评分、官方受影响范围及修复状态只能标作转述；不能把转载或 Vulners 聚合页当成奇安信原始通告。[转载及其来源声明][reprint]
- **Discussion #853 是研究者的一手报告，不是厂商安全通告。** 本次页面显示两名参与者：报告者 `OracleNep` 与回复者 `web-hacker-team`。后者引用 #76，认为是配置风险；本次未见其维护者身份依据，亦未见官方作者在 #853 宣布修复。[#853 回复][discussion-reply]
- **#76 的引文不能证明当前修复状态。** 可追溯到 `seanxuu` 于 2026-08-13 的回复：“remote authentication is not available yet”，并要求使用 loopback、称转发不受支持。它早于 8 月 25 日鉴权提交，不能用于推断当前版本仍无认证；本次未独立确认该回复者的官方身份。[原始回复][discussion-76]
- **Context7 有新旧内容混杂。** 对 `/deepseek-ai/deepseek-harness` 的查询同时返回新版 Cookie 实现与旧版“无认证”README；版本结论以上述固定标签、提交和发布记录为准。

## 对 LAN 免密决策的含义

研究判断：**LAN 地址或可达性不应授予控制权限；应默认拒绝匿名控制请求。** “不用输入密码”可以通过已认证设备、短期会话或安全隧道实现，不应等于“无需身份认证”。上游已经明确放弃用 Host 头代替身份的边界，且承认明文网络会暴露 Cookie。[上游设计][auth-design]

建议后续方案把身份认证、加密传输、会话撤销和敏感能力授权作为独立验收项，并覆盖 HTTP、SSE、WebSocket 等入口；不要因引入 Cookie 就宣称已达到完整零信任。插件是否保留、绕过或另行覆盖这些边界，交由主任务本地审计判断，本文件不作推断。

[release-alpha]: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1
[release-rc]: https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-rc.1
[releases-api]: https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=30
[auth-commit]: https://github.com/deepseek-ai/deepseek-harness/commit/3e24087bfaeabe40b58ba2f7b936895b8f93fe27
[sync-commit]: https://github.com/deepseek-ai/deepseek-harness/commit/9c964848cd54d6e9a7d5f01f1745936673cd1910
[auth-history]: https://api.github.com/repos/deepseek-ai/deepseek-harness/commits?path=packages/client/connection/src/browser-auth.ts&per_page=20
[compare-api]: https://api.github.com/repos/deepseek-ai/deepseek-harness/compare/9c964848cd54d6e9a7d5f01f1745936673cd1910...dsh-v0.1.2-alpha.1
[auth-design]: https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.2-alpha.1/.agents/notes/implemented/architecture/2026-08-24-browser-token-authentication.zh.md
[security-api]: https://api.github.com/repos/deepseek-ai/deepseek-harness/security-advisories
[discussion]: https://github.com/deepseek-ai/deepseek-harness/discussions/853
[discussion-reply]: https://github.com/deepseek-ai/deepseek-harness/discussions/853#discussioncomment-18162621
[discussion-76]: https://github.com/deepseek-ai/deepseek-harness/discussions/76#discussioncomment-18002653
[hackspeak]: https://github.com/HackSpeak/QVD-2026-57410
[reprint]: https://cn-sec.com/archives/5403588.html
