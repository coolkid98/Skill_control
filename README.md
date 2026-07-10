# Skill Control

面向业务 Skill 的在线版本控制与审批平台。它将 `credit_model/src/main/resources/skills` 的当前内容初始化为已发布 `v1`，支持 Markdown 在线编辑、不可变版本、逐文件差异、三角色审批、历史回滚、审计日志和发布包导出。

## 角色与流程

- **管理员**：创建/停用账号、分配单一角色、重置密码、查看审计日志。
- **编辑者**：新建 Skill、从当前发布版创建草稿、维护 Markdown 文件、提交审核。
- **审核者**：查看相对发布基线的差异，批准或驳回；提交者不能审核自己的版本。

提交后的版本快照不可修改。驳回后需要复制为新草稿；历史回滚也会创建新草稿并重新审批。若两个提交基于同一发布版本，先批准的版本生效，其他待审版本自动标记为“基线过期”。

审批通过不会直接修改 Java 项目。开发人员下载发布 ZIP 后，将其中的 `skills/` 替换到 `credit_model/credit_model/src/main/resources/skills/`，再重新构建部署智能体。

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

`BOOTSTRAP_ADMIN_*` 只在数据库没有管理员时使用。首次登录后必须修改密码。

### 2. 构建启动

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f
```

默认访问 `http://ECS公网IP:3002`。在阿里云安全组开放配置的 `APP_PORT`。若使用域名和 HTTPS，请由 Nginx/Caddy 反向代理至该端口，并将 `COOKIE_SECURE=true`；反向代理必须传递 `X-Forwarded-For` 和 `X-Forwarded-Proto`。

国内构建使用 DaoCloud Node 基础镜像和 npmmirror npm 源，与参考项目的部署方式一致。
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

`manifest.json` 记录版本号、版本 ID、审批时间、审批人和完整 Skill 快照的 SHA-256。草稿、驳回版本和基线过期版本不会进入发布包。

## 安全说明

- 不开放用户自助注册；所有写操作均在服务端验证角色。
- 会话使用 HttpOnly、SameSite=Strict Cookie；用户角色或状态改变后旧会话立即失效。
- Markdown 预览不执行原始 HTML，文件路径禁止绝对路径、上级目录和非 `.md` 文件。
- `SKILL.md` 必须包含合法 YAML frontmatter，`name` 必须与 Skill 目录名一致。
- 单文件上限 1 MiB、单 Skill 上限 100 个文件/5 MiB。
