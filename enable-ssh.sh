#!/usr/bin/env bash
# ==========================================================================
# SSH で root のパスワードログインを許可する
#  （PowerShell などから ssh root@IP でつなげるようにする）
# ==========================================================================
set -e

echo "=== SSH の設定を変更します ==="
cat >/etc/ssh/sshd_config.d/99-nogiku.conf <<'CONF'
PermitRootLogin yes
PasswordAuthentication yes
KbdInteractiveAuthentication yes
CONF

# 念のためメイン設定も調整
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true

# SSH を再起動
systemctl restart ssh 2>/dev/null || systemctl restart sshd

echo ""
echo "=== 完了！ PowerShell で もう一度  ssh root@162.43.28.12  を試してください ==="
