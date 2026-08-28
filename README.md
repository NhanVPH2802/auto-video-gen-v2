# Auto Video Gen 2.7.0

Auto Video Gen là hệ thống tạo video dọc 9:16 tự động từ URL, nội dung nhập trực tiếp hoặc file.

Pipeline chính:

**Tạo dự án → AI tạo kịch bản → duyệt từng frame → tạo Voice → Render Video → Outro**

## Phiên bản

**Production: 2.7.0**

Môi trường đã kiểm thử:

- Ubuntu Server 24.04 LTS
- Node.js 22
- npm 10
- FFmpeg 6.x
- systemd
- Port Dashboard: `3080`

---

# 1. Cài mới trên Ubuntu Server

## Bước 1 - Đăng nhập server

SSH vào Ubuntu Server bằng tài khoản có quyền `sudo`.

## Bước 2 - Cập nhật hệ thống

```bash
sudo apt update
sudo apt upgrade -y
```

## Bước 3 - Cài Git

```bash
sudo apt install -y git
```

## Bước 4 - Clone source

Repository hiện là Private nên cần tài khoản GitHub/PAT có quyền truy cập.

```bash
cd /opt
sudo git clone https://github.com/NhanVPH2802/auto-video-gen-v2.git
```

Khi GitHub yêu cầu:

```text
Username: NhanVPH2802
Password: <GitHub Personal Access Token>
```

GitHub không sử dụng password tài khoản cho Git HTTPS.

## Bước 5 - Chạy bộ cài

```bash
cd /opt/auto-video-gen-v2
sudo bash install.sh
```

Installer tự thực hiện:

- Cài dependency hệ thống.
- Cài Node.js 22 nếu chưa có.
- Cài FFmpeg.
- Tạo user `autovideo`.
- Cài Base Video Engine.
- Cài Dashboard 2.7.0.
- Cài npm packages.
- Tạo các thư mục runtime.
- Tạo systemd service.
- Enable service khi boot.
- Khởi động Auto Video Gen.

## Bước 6 - Kiểm tra service

```bash
sudo systemctl status auto-video-gen --no-pager -l
```

Trạng thái đúng:

```text
Active: active (running)
```

## Bước 7 - Truy cập Dashboard

Xem IP server:

```bash
hostname -I
```

Trên máy tính mở:

```text
http://IP-SERVER:3080
```

Ví dụ:

```text
http://192.168.1.152:3080
```

---

# 2. Cấu hình sau khi cài

Mở Dashboard và chọn **Set API**.

Sau đó cấu hình AI Provider cần sử dụng. Hệ thống hỗ trợ:

- Gemini
- OpenAI
- Claude / Anthropic
- GitHub Models
- Local AI
- OpenAI-compatible
- Custom AI REST

Tiếp theo cấu hình Voice Provider:

- VieNeu-compatible
- LucyLab
- OpenAI-compatible TTS
- Custom Voice REST

Sau khi Save/Test thành công, tạo một dự án ngắn để kiểm tra toàn bộ pipeline.

---

# 3. Test sau khi triển khai

Nên tạo video test khoảng 15–20 giây và kiểm tra:

1. AI tạo được kịch bản.
2. Intro xuất hiện đúng.
3. Các frame được tạo đúng.
4. Voice hoạt động.
5. Không có khoảng lặng bất thường giữa frame.
6. Theme được áp dụng.
7. Outro được render.
8. Follow card không bị cắt.
9. Video tải xuống được.

---

# 4. Các lệnh quản trị

```bash
sudo systemctl status auto-video-gen
sudo systemctl restart auto-video-gen
sudo systemctl stop auto-video-gen
sudo systemctl start auto-video-gen
sudo journalctl -u auto-video-gen -f
sudo journalctl -u auto-video-gen -n 100 --no-pager
```

---

# 5. Thư mục hệ thống

Ứng dụng production được cài tại:

```text
/opt/auto-video-gen/
```

Cấu trúc chính:

```text
/opt/auto-video-gen/
├── base/
├── dashboard/
├── data/
├── downloads/
├── output/
├── branding/
└── backups/
```

Không chạy production trực tiếp từ thư mục Git clone.

---

# 6. Dữ liệu cần backup

Quan trọng:

```text
/opt/auto-video-gen/data
/opt/auto-video-gen/branding
/opt/auto-video-gen/dashboard/.env.local
```

Nếu muốn giữ media/video:

```text
/opt/auto-video-gen/downloads
/opt/auto-video-gen/output
```

Không đưa `.env.local` lên GitHub.

---

# 7. Backup

```bash
sudo tar -czf /root/auto-video-gen-backup.tar.gz   /opt/auto-video-gen/data   /opt/auto-video-gen/branding   /opt/auto-video-gen/dashboard/.env.local
```

Backup đầy đủ:

```bash
sudo tar -czf /root/auto-video-gen-full-backup.tar.gz   /opt/auto-video-gen/data   /opt/auto-video-gen/branding   /opt/auto-video-gen/downloads   /opt/auto-video-gen/output   /opt/auto-video-gen/dashboard/.env.local
```

---

# 8. Chuyển sang server mới

1. Cài Ubuntu Server 24.04 LTS.
2. Clone repository.
3. Chạy `sudo bash install.sh`.
4. Stop service:

```bash
sudo systemctl stop auto-video-gen
```

5. Khôi phục `data`, `branding` và `.env.local`.
6. Sửa quyền:

```bash
sudo chown -R autovideo:autovideo   /opt/auto-video-gen/data   /opt/auto-video-gen/branding

sudo chown autovideo:autovideo   /opt/auto-video-gen/dashboard/.env.local

sudo chmod 600   /opt/auto-video-gen/dashboard/.env.local
```

7. Start lại:

```bash
sudo systemctl start auto-video-gen
```

8. Kiểm tra:

```bash
sudo systemctl status auto-video-gen --no-pager -l
```

---

# 9. Cập nhật source từ GitHub

```bash
cd /opt/auto-video-gen-v2
sudo git pull
```

Không copy thủ công source mới vào `/opt/auto-video-gen` nếu chưa có hướng dẫn nâng cấp cho phiên bản đó.

---

# 10. Kiểm tra phiên bản

```bash
node -v
npm -v
ffmpeg -version | head -n 1
```

Dashboard yêu cầu Node.js `>= 22`.

---

# 11. Port

Dashboard mặc định dùng TCP `3080`.

Nếu UFW đang bật:

```bash
sudo ufw allow 3080/tcp
sudo ufw status
```

---

# 12. Xử lý lỗi

```bash
sudo systemctl status auto-video-gen --no-pager -l
sudo journalctl -u auto-video-gen -n 100 --no-pager
sudo ss -lntp | grep 3080
sudo systemctl restart auto-video-gen
```

---

Production baseline của NhanVPH Tech.

Không commit API key, `.env.local`, dữ liệu dự án hoặc media runtime lên repository.
