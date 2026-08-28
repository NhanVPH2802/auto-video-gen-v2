# Auto Video Gen 2.0 Preview 2.7.0

Bản 2.7.0 kế thừa toàn bộ fix 2.6.3 và bổ sung các yêu cầu mới cho workflow tạo video.

## Tính năng mới 2.7.0

### 1. Intro / giới thiệu nội dung

- Form tạo dự án có trường **Intro / Giới thiệu nội dung**.
- Nếu để trống, AI tự tạo một frame Intro ngắn ngay sau Hook.
- Nếu nhập nội dung, frame thứ 2 sẽ dùng nội dung này làm lời đọc và phần hiển thị Intro.
- Intro dùng template `callout` để tương thích renderer hiện tại, tag hiển thị là `GIỚI THIỆU`.

### 2. Tên dự án

- Có trường **Tên dự án** riêng, chỉ dùng để quản lý dashboard.
- Tên dự án không làm thay đổi tiêu đề nội dung mà AI tạo.
- Danh sách dự án, cửa sổ chi tiết và chế độ sửa đều ưu tiên hiển thị tên dự án này.
- Nếu bỏ trống, dashboard vẫn fallback về tiêu đề nguồn như trước.

### 3. Outro tự giữ nội dung cũ

- Khi tạo dự án mới, hệ thống tự tìm Outro của dự án gần nhất và nạp lại toàn bộ nội dung Outro.
- Khi sửa lại chính dự án, hệ thống ưu tiên giữ Outro của phiên bản trước của dự án đó.
- Nếu người dùng sửa Outro trong bước **Duyệt kịch bản**, phiên bản đã sửa sẽ trở thành Outro được dự án kế tiếp tự nạp lại.
- Tên kênh vẫn lấy Branding hiện tại để tránh giữ nhầm tên kênh cũ.
- Social footer Facebook / YouTube / TikTok vẫn được sinh tự động khi render như bản trước.

### 4. Follow card rộng hơn

- Follow card tăng từ khoảng 760px lên tối đa 840px.
- Safe-area hai bên giảm còn 60px.
- Nút Follow / Following tăng lên 230px và thêm padding, căn giữa chữ.
- Vẫn dùng `left:0; right:0; margin:auto`, không dùng translateX/xPercent để tránh GSAP đẩy card lệch khung.

## Các fix 2.6.3 vẫn giữ

- Tech Blue / Ubuntu / Gradient áp đúng vào renderer.
- VieNeu-TTS trim silence đầu/cuối chunk và loại cache audio dài bất thường.
- Danh sách dự án phân trang 5 / 10 / 20 / Tất cả.
- Có nút xóa dự án cũ và xóa cả output liên quan.
- Persistent Branding, scene editor, script approval, render lại, transition, motion và background riêng.

## Cài trên bản native/systemd

```bash
cd /opt
unzip -o auto-video-gen-v2-preview2.7.0.zip
cd /opt/auto-video-gen-v2-preview2.7.0
sudo bash install-preview.sh
```

Kiểm tra:

```bash
sudo systemctl status auto-video-gen --no-pager -l
```

Sau đó mở dashboard và nhấn `Ctrl + F5`.

## Áp vào source Docker/GitHub

```bash
cd /opt/auto-video-gen-v2-preview2.7.0
sudo ./apply-to-source.sh /opt/auto-video-gen-github

cd /opt/auto-video-gen-github
docker compose build auto-video-gen
docker compose up -d --force-recreate
```

## Test nhanh sau khi cài

1. Tạo Project A, đặt tên dự án và sửa Outro theo ý muốn.
2. Tạo Project B: Outro phải tự lấy lại nội dung của Project A.
3. Nhập Intro riêng: frame 2 phải là `GIỚI THIỆU`.
4. Render Outro: nút `Follow/Following` phải hiện đủ chữ và không bị cắt.
5. Test lại Theme Tech Blue / Ubuntu / Gradient và video 60 giây để xác nhận các fix 2.6.3 vẫn hoạt động.
