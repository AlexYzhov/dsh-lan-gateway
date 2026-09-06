<p align="center">
  <img src="assets/banner.webp" alt="dsh-lan-gateway — 把 DeepSeek Harness 的 Web GUI 安全地开放到局域网 / 公网" />
</p>

<h1 align="center">dsh-lan-gateway — LAN / 公网网关插件</h1>

<p align="center">
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-4d6bfe?logo=deepseek&logoColor=fff&style=flat-square" alt="DeepSeek Harness" />
  <img src="https://img.shields.io/badge/version-0.5.0-2b7fff?style=flat-square" alt="version 0.5.0" />
  <img src="https://img.shields.io/badge/TLS-8b5cf6?logo=lock&logoColor=fff&style=flat-square" alt="TLS" />
  <img src="https://img.shields.io/github/license/rice-awa/dsh-lan-gateway?style=flat-square" alt="MIT license" />
</p>

> 把 DeepSeek Harness 的 Web GUI 安全地开放到局域网 / 公网。
> 附带**不安全源 UUID shim**：网关以纯 HTTP 局域网地址服务页面时，浏览器不提供
> `crypto.randomUUID`，本插件的 client bundle 会在页面加载早期自动补上
> `getRandomValues` 版实现，让工作区（含其他设备打开的工作区）在网关下正常打开。
> 附带**TLS 支持**：可用自动生成并持久化的**自签名证书**，或挂载**自己申请/签发的
> PEM 证书**，让网关以 HTTPS 服务（自签名证书首次访问会看到浏览器警告，属预期行为）。

`dsh` 的 web CLI 会硬拒绝 `--host 0.0.0.0`（避免把远程代码执行暴露到网络），所以本插件
让 dsh 继续只绑 `127.0.0.1`，自己另起一个 `0.0.0.0` 反向代理网关转发到 loopback 端口，
改写 `Host`/`Origin`。**默认拒绝（fail-closed）：所有来源——loopback、LAN、公网——都必须
先通过网关的登录页并出示 HMAC 会话 cookie**；“LAN 免密”改为显式 `lanPasswordless` opt-in
且默认关闭。对 dsh ≥ 0.1.2-rc.1（修复了 QVD-2026-57410 的浏览器会话认证底座），网关在进程内
中继**一条共享的上游会话**，上游自身的授权仍然把关每个请求——网关只决定谁能骑上这条
共享会话。

## 特性

- **双端一体**：host 端是反向代理网关（登录 / HMAC cookie / 会话撤销 / Origin 围栏 /
  TLS / 上游会话中继）；client 端是不安全源 UUID shim + **官方设置页卡片**（DSH Settings
  → Plugins → 可配置插件，网关的端口 / 网段 / 认证 / TLS 全部可视化调整，保存即热生效）。
- **默认全来源登录（QVD-2026-57410 加固）**：不再“只对公网来源认证”；loopback/LAN 同样
  要求会话。唯一豁免是显式 `lanPasswordless: true`（仅豁免网关登录，上游会话中继仍生效）。
- **共享上游会话中继**：dsh 0.1.2 起不再信任 loopback Host，要求出示绑定权威来源的
  `dsh-auth-*` cookie；插件在进程内用启动令牌走一遍浏览器等价换取，把这一条会话中继到
  每个转发请求上（“单密码 = 单操作者”语义不变）。底座不支持时自动降级为无中继转发。
- **fail-closed 启动守卫**：未设密码拒启；`authRequired:false`（v0.4 及更早）拒启并给迁移
  文案；明文监听需显式 `allowInsecurePlaintext:true`（或 TLS / 声明 `trustedTerminator`）。
- **TLS 双模式**：`self-signed` 自动生成自签名证书（首次启动生成并持久化到
  `~/.dsh/lan-gateway/tls/`，重启复用；`lan_gateway tls-regenerate` 可换新证书），或
  `custom` 直接挂载你自己的 PEM 证书与私钥（如 Let's Encrypt / 自建 CA 签发）。
- **会话撤销**：cookie 携带撤销 epoch；改密 / 清密 / `rotate-secret` 都会递增 epoch，使
  所有已签发 cookie **与已建立的 WebSocket** 立即失效。清空密码会直接停止监听。
- **默认关闭（安全）**：bundle patch 里 `enabled: false`，只有运行 `lan_gateway enable`
  后才监听网络端口。
- **密钥不进配置**：密码哈希、cookie secret 存 `~/.dsh/lan-gateway/state.json`。

## 快速安装（推荐）

已发布到 npm（预构建，安装无需 `allowBuilds` 授权）。请把下面这段话发送给你的 agent：

> 帮我安装 dsh 插件 `@riceawa/dsh-lan-gateway`，遵循
> `https://github.com/rice-awa/dsh-lan-gateway/blob/main/INSTALL.md`

## 配套 skill

仓库还带一个 [lan-gateway](skills/lan-gateway.md) 技能：让 dsh 的 agent 在对话中
自动管理网关——开/关监听、设置或更换远程访问密码、轮换会话密钥、查看状态。装上后
直接说「设置网关密码为 …」「开启远程访问」即可，agent 会调用 `lan_gateway` 工具
完成（密码以参数传入，不写入配置、不回显）。安装方式见
[INSTALL.md](INSTALL.md#for-agents完整安装流程)。

## 移动端访问（推荐）

在手机 / 平板上通过网关访问 GUI 时，桌面布局体验不佳。推荐同时安装
[dsh-web-mobile](https://github.com/mexiaosqwq/dsh-web-mobile)（移动端 UI 适配），
与本插件配合使用：

```bash
dsh plugin --profile web add github:mexiaosqwq/dsh-web-mobile
```

## 手动安装

### 方式 A：npm 包（推荐，免 allowBuilds）

已发布预构建产物到 npm，安装时**不需要**批准构建脚本：

```bash
# 官方装配（重启后由 bundles 列表接管，生产态）
dsh plugin --profile web add @riceawa/dsh-lan-gateway
```

> `dsh plugin ... add` 把剩余参数转发给 profile 目录里的 pnpm，npm 包自带预构建
> 的 `lib/`，不会触发 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`。若仍提示，把报错
> 条目写进 `~/.dsh/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 再重试，
> 完整步骤见 [INSTALL.md](INSTALL.md#for-agents完整安装流程)。

### 方式 B：从源码构建

```bash
git clone https://github.com/rice-awa/dsh-lan-gateway.git
cd dsh-lan-gateway
pnpm install
pnpm build          # host（lib/index.js）
pnpm build:client   # client（lib/client.js，window.__ModuleLoader__ 格式）
pnpm test           # 72 项（网关单元 27 + start-guard 12 + 集成 17 + UUID shim 3 + x509 6 + TLS 7）
```

## 使用

```bash
# 开启网关。先满足启动条件（已设密码 + 加密入口），否则 enable 会给出迁移文案
lan_gateway enable

# 查看状态（端口 / 目标 / 密码 / 会话 epoch / 中继状态 / 入口加密方式 / 上次错误）
lan_gateway status

# 设置登录密码（≥8 位；改动会让所有已签发会话立即失效）
lan_gateway set-password

# 轮换会话密钥（作废全部登录 cookie 与已建立的 WebSocket）
lan_gateway rotate-secret

# 换发自签名 TLS 证书（tlsMode=self-signed 时；换新密钥并热重启监听器）
lan_gateway tls-regenerate

# 关闭
lan_gateway disable
```

> `lan_gateway` 是一个模型可调用的工具，上面的命令不必由你手动敲——**直接在 dsh 对话
> 里说即可**，例如“设置网关密码为 ……”（模型会调用 `lan_gateway set-password`，密码以
> 参数传入、不会回显）、“查看网关状态”、“开启 / 关闭网关”。在对话中设置密码时请直接
> 把密码说给模型，它不会把密码写进任何配置文件。

## 配置项（bundle patch / `--patch` 覆盖，或官方设置页）

所有可调项都同时暴露为 `lan-gateway` 用户设置命名空间：打开 **DSH 的 Settings → Plugins
→ 可配置插件**，展开「LAN 网关」卡片即可修改，保存即生效（监听器会按新配置自动重启）。
下表即卡片字段 / 配置键：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `enabled` | `false` | 是否在启动时监听网络端口 |
| `gatewayPort` | `3081` | 网关监听端口（`0.0.0.0`） |
| `dshTargetPort` | 跟随 `ctx.webServer.port` | 转发到的 dsh loopback 端口 |
| `lanCidrs` | RFC1918 + link-local（见下） | 视为 LAN 的网段；仅在 `lanPasswordless` 开启时用作豁免匹配集 |
| `lanPasswordless` | `false` | 显式 opt-in：LAN/loopback 来源跳过网关登录页（上游会话中继仍把关） |
| `cookieMaxAgeDays` | `7` | 会话 cookie 有效期（天） |
| `cookieName` | `dsh_gw_auth` | 会话 cookie 名（不进卡片） |
| `tlsEnabled` | `false` | 是否以 HTTPS（TLS）提供服务 |
| `tlsMode` | `self-signed` | 证书来源：`self-signed` 自动生成 / `custom` 用自己的证书 |
| `tlsSelfSignedHosts` | `localhost` | 自签名证书的 SAN（逗号分隔的域名 / IP） |
| `tlsCertPath` | — | `custom` 模式：PEM 证书（或证书链）绝对路径 |
| `tlsKeyPath` | — | `custom` 模式：PEM 私钥绝对路径 |
| `tlsCertMaxAgeDays` | `825` | 自签名证书有效期（天） |
| `allowInsecurePlaintext` | `false` | 显式 opt-in：允许明文 HTTP 监听（见下「入口加密」） |
| `trustedTerminator` | — | 声明一个受信 TLS 终止代理标识，视为加密入口（如 `nginx`） |

> v0.5.0 起 `authRequired` 被移除：认证恒为必需。若配置里残留 `authRequired: false`
> （v0.4 及更早的写法），启停守卫会拒绝并提示迁移——不会静默降级回“免密”。

### 入口加密（防明文）

网关默认**拒绝纯明文监听**，三种方式任选其一即可启动：

1. 启用 TLS：`tlsEnabled: true`（推荐，自签名或 custom 证书均可）；
2. 声明由可信反向代理（nginx 等）终止 TLS：
   ```yaml
   - id: dsh-lan-gateway
     config:
       enabled: true
       gatewayPort: 8080
       trustedTerminator: nginx   # 由 nginx 以 HTTPS 对外，再转发回本端口
   ```
3. 显式接受明文（风险自担，密码与会话将明文在网内传输）：
   ```yaml
   - id: dsh-lan-gateway
     config:
       enabled: true
       gatewayPort: 3081
       allowInsecurePlaintext: true
   ```

自签名证书在**首次启用 TLS 时生成一次**，持久化于 `~/.dsh/lan-gateway/tls/`
（`selfsigned.crt` / `selfsigned.key`，0600），之后重启复用同一张证书；
`lan_gateway tls-regenerate` 可随时换发新证书（新密钥）并热重启监听器。

或用自己的证书（例如 `/etc/letsencrypt/live/example.com/` 下签发的 PEM）：

```yaml
- id: dsh-lan-gateway
  config:
    tlsEnabled: true
    tlsMode: custom
    tlsCertPath: /etc/letsencrypt/live/example.com/fullchain.pem
    tlsKeyPath: /etc/letsencrypt/live/example.com/privkey.pem
```

启用 TLS（或声明受信终止代理）后，登录 cookie 自动带 `Secure`；监听器自身是 HTTPS 时，
网关响应（登录页 / 重定向 / 拒绝）带 HSTS。自签名证书首次访问会看到浏览器警告，属预期行为。

默认 `lanCidrs`：`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`169.254.0.0/16`；
IPv6 的 `fe80::/10`（link-local）与 `127.0.0.0/8` / `::1` 归类为 LAN/loopback。

## 安全模型

- **来源分级**：仅依据 `socket.remoteAddress`（IPv4-mapped IPv6 会先解包）把请求分为
  loopback / lan / internet 三档，绝不信任 `X-Forwarded-For`。**分级本身不授予任何访问**
  ——默认每一档都必须出示有效网关会话，否则 302 到 `/__login`。
- **LAN 免密是显式 opt-in**：`lanPasswordless: true` 只让命中 `lanCidrs`（或 loopback）的
  来源跳过**网关自己的登录页**；上游 dsh 若 ≥ 0.1.2-rc.1，插件在进程内中继一条共享上游
  会话（见下），上游授权仍把关每个请求。底座没有浏览器会话认证时该开关**拒绝启用**——
  否则就是把 QVD-2026-57410 原样装回去。
- **共享上游会话中继（dsh ≥ 0.1.2-rc.1）**：dsh 已不再信任“回环 Host”，要求请求出示
  HMAC 签名的 `dsh-auth-*` cookie。插件经 `connection` 服务拿到启动令牌，在回环传输上
  做浏览器等价的令牌换取，取得 cookie 后中继到每个转发请求；上游一旦以 401 拒绝就丢弃
  这条会话并重新换取。**这仍是“单密码 = 单操作者”**：通过网关登录的人都骑同一条上游
  会话，上游持钥，才是真正的授权主体。
- **登录页**：`/__login` 由网关独占、不转发；密码以 scrypt（每写一次重新加盐）校验，
  登录尝试按来源限流（5 次 / 分钟）。
- **会话 cookie**：`payload.signature` 结构（HMAC-SHA256），携带**撤销 epoch**；
  `HttpOnly; SameSite=Strict`，过期即失效。改密 / 清密 / `rotate-secret` 递增 epoch，
  作废全部已签发 cookie **并断开已建立的 WebSocket**，客户端重新登录。清空密码会停止
  监听（网关必须有密码才能运行）。
- **管理面不外泄**：`/lan-gateway/*`（含配置路由）由网关独占、一律 403 不转发——远程
  访问者无法借网关改写 Host 触及本机 loopback 的配置接口；原生 `/lan-gateway/config`
  仅对回环 Host 且同源的请求应答（本地用户 / 本机能读 `~/.dsh` 的进程）。远程管理走
  `lan_gateway` 工具。
- **CSRF / 跨站围栏（HTTP 与 WebSocket）**：因为网关把 Origin 改写回 loopback、会蒙蔽
  dsh 自身的 CSRF 防线，网关在改写前对每个转发请求自检：`sec-fetch-site: cross-site`
  直接拒绝；Origin 必须匹配访问者实际使用的网关权威来源；状态变更方法与 WebSocket
  升级请求**必须携带同源 Origin**，否则 403。
- **密码未设置时拒启**：无论来源如何，未设密码一律拒绝监听——杜绝把远程代码执行门户
  开放给任何非本机来源。
- **WebSocket**：`/api` 升级请求同样过登录校验、同源 Origin 校验，再拼接转发给 dsh，
  并纳入会话撤销（epoch 变化即断开）。

## 从 v0.4（及更早）升级

1. **把底座升级到 dsh ≥ 0.1.2-rc.1**（含 QVD-2026-57410 上游修复）。低于该版本时本插件
   仍可运行，但 `lanPasswordless` 会拒绝启用（fail-closed）。
2. 若配置里写过 `authRequired: false`：删除它。现在认证恒为必需；LAN 想免密改为显式
   `lanPasswordless: true`。
3. 若以明文（无 TLS）运行且从未设置过密码：升级后 `enable` 会拒绝。请启用 TLS /
   声明 `trustedTerminator` / 显式 `allowInsecurePlaintext: true` 之一，并先
   `lan_gateway set-password`。
4. 曾以“免密 + 伪造 Host”形态暴露过受影响的 dsh 实例：按“可能已失陷”处置——轮换模型 /
   系统凭据，并检查是否有未知登录会话。

一步到位迁移示例（HTTPS 自签名 + LAN 免密，本机已跑通）：

```yaml
- id: dsh-lan-gateway
  config:
    enabled: true
    tlsEnabled: true
    tlsMode: self-signed
    # 证书 SAN 覆盖所有接入方式：回环 / 主机名 / LAN IP / Tailscale IP。
    # Tailscale 走 100.64.0.0/10（CGNAT），按默认 lanCidrs 归为 internet，
    # 仍需密码登录，不会因 lanPasswordless 而豁免。
    tlsSelfSignedHosts: localhost,my-host,192.168.1.20,100.99.1.2
    lanPasswordless: true   # LAN/loopback 免登录；需 dsh ≥ 0.1.2-rc.1 上游会话底座
```

首次以 `https://<主机名|LAN-IP|Tailscale-IP>:3081` 访问会看到自签名证书警告（预期）。
证书在首次启用 TLS 时生成一次并持久化到 `~/.dsh/lan-gateway/tls/`；若已有一张旧证书，
**必须用 `lan_gateway tls-regenerate` 重新签发**，新的 `tlsSelfSignedHosts` 才会进入 SAN。

## 登录页截图（预期）

远程来源打开 `http://<主机>:3081/` 时，先看到网关自带的登录表单（`/__login`），
输入正确密码后签发会话 cookie 并跳回 `/`。

<p align="center">
  <img src="assets/login-screenshot.webp" alt="网关登录页截图" width="320" />
</p>

## UUID shim 说明（v0.2.0 新增）

**问题**：网关以 `http://<LAN-IP>:3081` 服务页面，浏览器视其为不安全源，
`crypto.randomUUID()`（secure-context-only）为 `undefined` → 每次 RPC id 铸造抛
`crypto.randomUUID is not a function` → 打不开工作区。

**原理**：client bundle 在**模块级**（一被浏览器求值、早于任何官方代码铸造 id）给
`Crypto` 原型补一个 `crypto.getRandomValues()` 版 `randomUUID`（RFC 4122 v4；
`getRandomValues` 在所有源都可用）。安全源 / Node ≥19 下为 no-op，不影响任何行为。

**覆盖范围**：对官方所有 `crypto.randomUUID()` 调用点（含未来新增）一律生效，
无需改动 DSH 源码。

## 测试

```bash
pnpm test
# ✓ tests/gateway.test.ts               (27) 分类 / HMAC cookie / epoch / 密码状态 / 限流
# ✓ tests/start-guard.test.ts           (12) fail-closed 启动守卫 / 配置路由回环围栏
# ✓ tests/integration/gateway.test.ts   (17) 真实网关端到端：全来源登录 / LAN 豁免 /
#                                            跨站 403 / 升级拒绝 / cookie 属性 / epoch 撤销 / 会话中继
# ✓ tests/uuid-shim.test.ts             ( 3) 不安全源补丁 / 安全源 no-op / v4 正确性
# ✓ tests/x509.test.ts                  ( 6) 自签名证书 DER/SAN/签名/TLS 握手
# ✓ tests/tls.test.ts                   ( 7) 证书持久化 / 重生成 / 自定义证书加载
```

## 安全评估与修复记录

0.5.0 的默认拒绝模型源自针对 QVD-2026-57410（DSH Web API 的 Host 信任缺陷）的加固，
相关文档收在 [docs/security/](docs/security/)：

- [LAN 网关安全评估](docs/security/SECURITY-AUDIT.md)——0.4.0 时代 F1–F5 审计快照与 13 个
  隔离观察（顶部标注 0.5.0 的修复状态）。
- [QVD-2026-57410 修复方案](docs/security/qvd-2026-57410-fix-plan.md)——方案全文 + §15
  实施状态（0.5.0 落地差异）。
- [上游研究](docs/security/qvd-2026-57410-research.md)——公开通告 / 上游提交与版本核对。

## 许可

[MIT](./LICENSE)
