# 更新日志

## 0.5.3

修掉明文代理入口下的登录死循环。声明了 `trustedTerminator`、但那个代理只做明文用户鉴权（浏览器以 `http://` 访问代理）时，密码输对了也会立刻弹回 `/__login`。

原因是 `trustedTerminator` 被无条件当成加密入口，登录 cookie 一律加 `Secure`；浏览器拒收明文 http 上的 Secure cookie，会话在登录跳转之间就没了。

新增 `secureCookies` 配置项显式覆盖该属性，留空 = 自动（原来的推断规则）。设置页对应「自动 / 始终 Secure / 不加 Secure」三档。`lan_gateway status` 现在报告实际生效的属性，以及声明的代理属于 TLS 还是明文入口。

同时补上共享会话中继的日志：中继从不抛异常（换取失败就退回匿名转发），导致「cookie 名字不对」「上游不可达」「底座根本没有浏览器会话」三种情况在日志里长得一模一样。现在 `UpstreamSessionRelay` 接了 `ctx.logger`，每次换取都记录结果，失败时列出上游实际返回的 cookie 名字。顺带修掉一处小失效：`authenticatedUrl()` 瞬时不可用时不再把已持有的会话丢掉（那会以匿名身份转发、必然 401），而是继续用仍可能有效的会话。

## 0.5.2

修掉共享上游会话中继的 cookie 匹配。0.5.0 / 0.5.1 装在 dsh ≥ 0.1.2-rc.1 上时，网关自己的登录能过，但每个转发请求都被上游 401，浏览器只看到：

```
dsh web authentication required; reopen the URL printed by dsh web.
```

插件原先用 `dsh-auth-=` 这个前缀去找上游签发的会话 cookie，而 dsh 实际签发的名字是 `dsh-auth-<base64url(sha256(authority))>`，前缀后面永远跟哈希而不是 `=`，匹配必然为空。令牌换取本身是好的（`GET /?token=…` 确实发出、也拿到了 `Set-Cookie`），只是那条 cookie 在这一步被丢弃，转发请求全部以匿名身份发出。现在改为「名字以 `dsh-auth-` 开头且后面还有内容」。

同一失效域还修掉一个启动竞态：`listenerKey` 把「中继是否可用」计入重启判据。监听器若早于 `connection` 服务启动（因此没有中继），会在服务挂载后自动重启，而不是一直匿名转发、状态里却写着 relay active。

新增 `tests/upstream-session.test.ts`，用真实回环 HTTP 服务端跑完整换取链路（集成测试注入的是假会话对象，正好绕过了这段）。

## 0.5.1

修掉加载失败。0.5.0 及更早装在 dsh ≥ 0.1.2-rc.1 上会让整个 plugin tree 起不来：

```
Error: dsh: plugin tree failed to load: ...
SyntaxError: The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'
```

`@deepseek-ai/dsh-settings` 从 `0.1.2-rc.1` 起删掉了 `settingsNamespace()` 这个品牌化辅助函数（命名空间改为 `register()` 内部校验的普通字符串字面量），旧插件在 ESM 链接期就失败。cordis 的 include 一旦失败会连坐整棵树，所以表现是所有插件都起不来，而报错点看着像隔壁插件的名字。

0.5.1 移除了该导入，运行时行为不变：新旧版本的 `register()` 都按同一个 `NAMESPACE_PATTERN` 校验并原样接受这个字面量。因此 0.5.1 在 `0.1.0-rc.6` 到 `0.1.5-rc.2` 的底座上都能加载。

## 0.5.0

默认拒绝模型的加固版本，针对 QVD-2026-57410（DSH Web API 的 Host 信任缺陷）。

- 移除 `authRequired`，认证恒为必需。所有来源——loopback、LAN、公网——都要出示网关会话；LAN 免密改为显式 `lanPasswordless`，默认关闭。
- 新增共享上游会话中继。
- 未设密码一律拒绝监听。

## 从 v0.4 及更早升级

1. 把底座升到 dsh ≥ 0.1.2-rc.1（含 QVD-2026-57410 的上游修复）。低于该版本插件仍能跑，但 `lanPasswordless` 会拒绝启用。
2. 配置里写过 `authRequired: false` 的删掉它。想要 LAN 免密就改成 `lanPasswordless: true`。
3. 以明文（无 TLS）运行且从未设过密码的，升级后 `enable` 会拒绝。先启用 TLS / 声明 `trustedTerminator` / 显式 `allowInsecurePlaintext: true` 之一，再 `lan_gateway set-password`。
4. 曾以「免密 + 伪造 Host」形态暴露过的实例，按可能已失陷处置：轮换模型和系统凭据，检查有没有未知登录会话。

一步到位的迁移示例（HTTPS 自签名 + LAN 免密）：

```yaml
- id: dsh-lan-gateway
  config:
    enabled: true
    tlsEnabled: true
    tlsMode: self-signed
    # 证书 SAN 覆盖所有接入方式。Tailscale 走 100.64.0.0/10（CGNAT），
    # 按默认 lanCidrs 归为 internet，仍需密码登录。
    tlsSelfSignedHosts: localhost,my-host,192.168.1.20,100.99.1.2
    lanPasswordless: true
```

首次以 `https://<主机名|LAN-IP|Tailscale-IP>:3081` 访问会看到自签名证书警告（预期）。证书在首次启用 TLS 时生成一次并持久化到 `~/.dsh/lan-gateway/tls/`；若已有一张旧证书，必须用 `lan_gateway tls-regenerate` 重新签发，新的 `tlsSelfSignedHosts` 才会进 SAN。
