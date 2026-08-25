# Skill Control

面向业务 Skill 的在线版本控制与审批平台。它将 `credit_model/src/main/resources/skills` 的当前内容初始化为已发布 `v1`，支持 Markdown 在线编辑、不可变版本、逐文件差异、三角色审批、投产日期分区、历史回滚、审计日志和发布包导出。

## 角色与流程

- **管理员**：创建/停用账号、分配单一角色、处理密码重置申请、审批投产日期变更申请、直接调整已批准版本的投产日期、查看审计日志。
- **编辑者**：新建 Skill、从当前发布版创建草稿、维护 Markdown 文件、填写星期五的投产日期并提交审核；可对已批准版本申请改期。
- **审核者**：查看相对发布基线的差异，确认最终投产日期为星期五并批准或驳回；提交者不能审核自己的版本，也可对已批准版本申请改期。

提交后的版本快照不可修改。驳回后需要复制为新草稿；历史回滚也会创建新草稿并重新审批。若两个提交基于同一发布版本，先批准的版本生效，其他待审版本自动标记为“基线过期”。

审批通过不会直接修改 Java 项目。开发人员下载发布 ZIP 后，将其中的 `skills/` 替换到 `credit_model/credit_model/src/main/resources/skills/`，再重新构建部署智能体。

用户首次登录仍需修改临时密码；完成首次修改后，可以通过左下角账户区域随时再次自助修改密码。每次修改都会注销现有会话并要求重新登录。忘记密码时可在登录页提交申请，系统不会暴露用户名是否存在；管理员在用户管理页设置临时密码并通过企业内部渠道告知用户，申请随后自动完成。

## 投产日期管理

投产日期保存在版本上，格式为 `YYYY-MM-DD`，新填写或调整的日期必须是星期五（例如 `2026-08-28`、`2026-09-04`）。前端日期控件和后端接口都会校验星期，不能通过绕过页面提交其他日期。新版本提交审核前必须选择日期，审核者批准时可以确认或调整最终日期。

已批准版本会进入“投产管理”页面并按日期分组，每个分组都可以下载独立 ZIP 发布包。管理员可以调整任意单个已批准历史版本，也可以把同一日期下的整个批次统一移动到另一个星期五；调整只改变分区元数据，不修改 Skill 文件或版本号，并会记录调整前后的日期到审计日志。升级前已经存在的非周五日期仍可查看和导出，但管理员再次调整时必须选择星期五。

编辑者和审核者可以在投产管理页为任意已批准版本提交改期申请，填写新的星期五日期和业务原因。申请提交后原投产日期保持不变，管理员批准后才移动到新分区；管理员也可以驳回并填写原因。同一版本同一时间只允许一个待审批申请。如果管理员在审批前直接调整了单个版本或整个批次，相关旧申请会自动失效，避免旧申请覆盖新日期。申请、批准、驳回和自动失效均保留审计记录。

如果同一个 Skill 在同一投产日期存在多个已批准版本，该日期的发布包只包含版本号最高的一版，避免 ZIP 中同名目录相互覆盖。全量“当前发布包”仍只包含每个 Skill 当前最新批准的版本。

## 本地开发

要求 Node.js 20+。

```bash
cp .env.example .env
# 将 .env 中的 JWT_SECRET 改成至少 32 位随机字符串
npm run install:all
npm run dev
```

浏览器访问 `http://localhost:5173`。Vite 会把 `/api` 代理到后端 `http://localhost:3000`。

非生产环境未设置管理员变量时，可使用 `admin / admin12345` 首次登录，登录后必须修改密码。生产模式不提供默认管理员密码。

常用命令：

```bash
npm test          # 后端和前端测试
npm run build     # 前端生产构建
npm start         # 启动后端（生产环境需先构建前端）
```

## 阿里云 ECS + Docker 部署

### 1. 上传并配置

将整个项目上传到服务器，进入项目目录：

```bash
cp .env.example .env
openssl rand -hex 32
```

把生成值填入 `.env` 的 `JWT_SECRET`，并设置初始管理员密码：

```dotenv
APP_PORT=3002
JWT_SECRET=生成的随机值
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=一个足够强的初始密码
BOOTSTRAP_ADMIN_DISPLAY_NAME=系统管理员
COOKIE_SECURE=false
```

`BOOTSTRAP_ADMIN_*` 只在数据库没有管理员时使用。首次登录后必须修改密码。直接通过 `http://IP:端口` 访问时保持 `COOKIE_SECURE=false`；只有配置 HTTPS 反向代理后才改为 `true`。

### 2. 构建启动

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f
```

默认访问 `http://ECS公网IP:3002`。在阿里云安全组开放配置的 `APP_PORT`。若使用域名和 HTTPS，请由 Nginx/Caddy 反向代理至该端口，并将 `COOKIE_SECURE=true`；反向代理必须传递 `X-Forwarded-For` 和 `X-Forwarded-Proto`。

国内构建使用 DaoCloud Node 基础镜像、阿里云 Debian 软件源和 npmmirror npm 源，与参考项目的部署方式一致。
`better-sqlite3` 在独立的 Docker 构建阶段安装 Python、make 和 g++ 完成原生编译；最终运行镜像只复制编译产物，不包含这些编译工具。

## 数据持久化与备份

SQLite 数据库位于容器 `/app/server/data/skill-control.db`，通过 `skill-control-data` 卷持久化。容器重建不会重复导入初始 Skill。

一致性备份建议短暂停止服务：

```bash
docker compose stop skill-control
docker run --rm \
  -v skill_control_skill-control-data:/data \
  -v "$(pwd)":/backup \
  docker.m.daocloud.io/library/node:20-slim \
  cp /data/skill-control.db /backup/skill-control-backup.db
docker compose start skill-control
```

恢复前先停止服务，并先备份现有数据库：

```bash
docker compose stop skill-control
docker run --rm \
  -v skill_control_skill-control-data:/data \
  -v "$(pwd)":/backup \
  docker.m.daocloud.io/library/node:20-slim \
  cp /backup/skill-control-backup.db /data/skill-control.db
docker compose start skill-control
```

如果 Compose 项目目录名不同，先用 `docker volume ls` 确认实际卷名。

从旧版本升级时，建议先按上述方式备份数据库，再重新构建镜像。应用启动后会自动新增所需的 `release_time` 字段、密码重置申请表和投产日期变更申请表；已有的已批准版本会使用原审批日期作为初始投产日期，已有待审版本可由审核者在批准时补填星期五日期。账号、密码哈希、版本和审计数据不会被清除。

## 发布包结构

全量导出只包含每个 Skill 的当前已批准版本：

```text
skills/
  customer-prescreen/
    SKILL.md
    references/...
  financial-statement-analysis/...
  industry-risk-analysis/...
manifest.json
```

`manifest.json` 记录版本号、版本 ID、投产日期、审批时间、审批人和完整 Skill 快照的 SHA-256。按投产日期导出的 ZIP 还会在清单顶层记录 `releaseTime`。草稿、驳回版本和基线过期版本不会进入发布包。

## 安全说明

- 不开放用户自助注册；所有写操作均在服务端验证角色。
- 会话使用 HttpOnly、SameSite=Strict Cookie；用户角色或状态改变后旧会话立即失效。
- Markdown 预览不执行原始 HTML，文件路径禁止绝对路径、上级目录和非 `.md` 文件。
- `SKILL.md` 必须包含合法 YAML frontmatter，`name` 必须与 Skill 目录名一致。
- 单文件上限 1 MiB、单 Skill 上限 100 个文件/5 MiB。

工作台的“最近动态”按日期倒序展示最近三个投产窗口；Skill 管理卡片则分别列出每个 Skill 在这三个窗口中的最新已批准版本。未设置投产日期的历史记录会单独归入“未设置投产窗口”，且不占用三个窗口名额。
