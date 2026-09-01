#!/usr/bin/env bash

set -Eeuo pipefail

DEFAULT_DOMAIN="www.mythought.cn"
SITE_NAME="skill-control"

usage() {
  cat <<EOF
用法：
  sudo bash scripts/configure-https.sh [证书通知邮箱] [域名]

示例：
  sudo bash scripts/configure-https.sh admin@example.com
  sudo bash scripts/configure-https.sh admin@example.com www.mythought.cn

不填写邮箱时，脚本会提示输入。
默认域名：${DEFAULT_DOMAIN}
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

EMAIL="${1:-}"
DOMAIN="${2:-$DEFAULT_DOMAIN}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"

if (( EUID != 0 )); then
  echo "错误：请使用 sudo 运行此脚本。" >&2
  echo "例如：sudo bash scripts/configure-https.sh admin@example.com ${DOMAIN}" >&2
  exit 1
fi

if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ || "$DOMAIN" != *.* || "$DOMAIN" == .* || "$DOMAIN" == *. ]]; then
  echo "错误：域名格式不正确：${DOMAIN}" >&2
  exit 1
fi

if [[ -z "$EMAIL" ]]; then
  if [[ ! -t 0 ]]; then
    echo "错误：非交互环境必须通过第一个参数提供证书通知邮箱。" >&2
    usage
    exit 1
  fi
  read -r -p "请输入接收证书到期通知的邮箱：" EMAIL
fi

if [[ ! "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "错误：邮箱格式不正确：${EMAIL}" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "错误：未找到 ${ENV_FILE}，请在完整的 Skill Control 项目中运行脚本。" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "错误：未找到 ${COMPOSE_FILE}。" >&2
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "错误：尚未安装 Nginx，请先运行：" >&2
  echo "  sudo bash scripts/configure-nginx.sh ${DOMAIN} 3002" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "错误：未找到可用的 docker compose。" >&2
  exit 1
fi

if ! nginx -t; then
  echo "错误：当前 Nginx 配置检查失败，请先修复后再配置 HTTPS。" >&2
  exit 1
fi

NGINX_CONFIG="$(nginx -T 2>&1)"
if ! grep -Fq "server_name ${DOMAIN}" <<< "$NGINX_CONFIG"; then
  echo "错误：Nginx 生效配置中未找到域名 ${DOMAIN}。" >&2
  echo "请先运行：sudo bash scripts/configure-nginx.sh ${DOMAIN} 3002" >&2
  exit 1
fi

if [[ -f "/etc/nginx/sites-available/${SITE_NAME}" ]]; then
  NGINX_SITE_CONFIG="/etc/nginx/sites-available/${SITE_NAME}"
elif [[ -f "/etc/nginx/conf.d/${SITE_NAME}.conf" ]]; then
  NGINX_SITE_CONFIG="/etc/nginx/conf.d/${SITE_NAME}.conf"
else
  echo "错误：未找到 Skill Control 的 Nginx 站点配置文件。" >&2
  exit 1
fi

install_certbot() {
  if command -v certbot >/dev/null 2>&1; then
    echo "Certbot 已安装：$(certbot --version 2>&1)"
    return
  fi

  echo "正在安装 Certbot……"
  if command -v snap >/dev/null 2>&1; then
    snap install core >/dev/null 2>&1 || true
    snap refresh core >/dev/null 2>&1 || true
    if snap install --classic certbot; then
      ln -sf /snap/bin/certbot /usr/local/bin/certbot
      return
    fi
    echo "Snap 安装失败，尝试使用系统软件包安装。"
  fi

  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y certbot python3-certbot-nginx
  elif command -v yum >/dev/null 2>&1; then
    yum install -y certbot python3-certbot-nginx
  else
    echo "错误：无法自动安装 Certbot，请先手动安装 Certbot 及 Nginx 插件。" >&2
    exit 1
  fi
}

install_certbot

if ! certbot plugins 2>/dev/null | grep -q 'nginx'; then
  echo "错误：Certbot 的 Nginx 插件不可用。" >&2
  exit 1
fi

TIMESTAMP="$(date +%Y%m%d%H%M%S)"
NGINX_BACKUP="${NGINX_SITE_CONFIG}.before-https.${TIMESTAMP}"
ENV_BACKUP="${ENV_FILE}.before-https.${TIMESTAMP}"
cp -a "$NGINX_SITE_CONFIG" "$NGINX_BACKUP"
cp -a "$ENV_FILE" "$ENV_BACKUP"
echo "已备份 Nginx 配置：${NGINX_BACKUP}"
echo "已备份环境变量文件：${ENV_BACKUP}"

restore_nginx() {
  cp -a "$NGINX_BACKUP" "$NGINX_SITE_CONFIG"
  nginx -t >/dev/null 2>&1 && {
    if command -v systemctl >/dev/null 2>&1; then
      systemctl reload nginx || true
    else
      nginx -s reload || true
    fi
  }
}

echo "正在为 ${DOMAIN} 申请并部署 HTTPS 证书……"
if ! certbot --nginx \
  --domain "$DOMAIN" \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  --redirect \
  --keep-until-expiring \
  --non-interactive; then
  echo "证书申请或部署失败，正在恢复原 Nginx 配置。" >&2
  restore_nginx
  exit 1
fi

if ! nginx -t; then
  echo "HTTPS 配置校验失败，正在恢复原 Nginx 配置。" >&2
  restore_nginx
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl reload nginx
else
  nginx -s reload
fi

if grep -q '^COOKIE_SECURE=' "$ENV_FILE"; then
  sed -i 's/^COOKIE_SECURE=.*/COOKIE_SECURE=true/' "$ENV_FILE"
else
  printf '\nCOOKIE_SECURE=true\n' >> "$ENV_FILE"
fi

echo "已将 ${ENV_FILE} 中的 COOKIE_SECURE 设置为 true。"

if ! docker compose --project-directory "$PROJECT_DIR" up -d --force-recreate skill-control; then
  echo "容器重建失败，正在恢复 .env 并尝试恢复容器。" >&2
  cp -a "$ENV_BACKUP" "$ENV_FILE"
  docker compose --project-directory "$PROJECT_DIR" up -d --force-recreate skill-control || true
  exit 1
fi

HTTPS_STATUS="000"
if command -v curl >/dev/null 2>&1; then
  for _ in {1..15}; do
    HTTPS_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
      --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/api/health" || true)"
    [[ "$HTTPS_STATUS" == "200" ]] && break
    sleep 2
  done
else
  echo "警告：未安装 curl，跳过 HTTPS 健康检查。" >&2
fi

echo
echo "HTTPS 配置完成："
echo "  https://${DOMAIN}  →  Nginx:443  →  Skill Control"
echo "本机 HTTPS 健康检查：HTTP ${HTTPS_STATUS:-000}"

if [[ "$HTTPS_STATUS" != "200" ]]; then
  echo "警告：本机 HTTPS 健康检查未返回 200，请检查 Nginx 和容器日志。" >&2
fi

echo
echo "正在测试证书自动续期……"
if certbot renew --dry-run; then
  echo "证书自动续期测试通过。"
else
  echo "警告：证书已经部署，但自动续期测试失败；请稍后单独运行 sudo certbot renew --dry-run 检查。" >&2
fi

echo
echo "请通过浏览器访问：https://${DOMAIN}"
echo "请保留阿里云安全组 TCP 80，并确认 TCP 443 已开放。"
echo "以后不要再次运行 configure-nginx.sh；该脚本会检测 HTTPS 并停止，避免覆盖证书。"
