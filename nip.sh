#!/usr/bin/env bash
# ==========================================================================
# 仮の住所(nip.io)で https を使えるようにする
#  - nogikusauna.com のDNSが直るまでの“回避策”
#  - 162-43-28-12.nip.io は自動で 162.43.28.12 に変換される
# ==========================================================================
set -e
export DEBIAN_FRONTEND=noninteractive

echo "=== [1/2] nginx を仮の住所にも対応させます ==="
cat >/etc/nginx/sites-available/nogiku <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name api.nogikusauna.com 162-43-28-12.nip.io;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX
nginx -t
systemctl reload nginx

echo "=== [2/2] 仮の住所の証明書を取得して https を設定します ==="
certbot --nginx -d 162-43-28-12.nip.io \
  --non-interactive --agree-tos --no-eff-email \
  -m nogikusauna@gmail.com --redirect

echo ""
echo "=== 完了！ https://162-43-28-12.nip.io/health を開いて確認してください ==="
