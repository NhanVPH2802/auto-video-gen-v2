# Auto Video Gen 2.0 - Docker/GitHub

Muc tieu: dong bang source dang chay, day len GitHub, GitHub Actions tu build image vao GHCR.

## Server dang chay tot

```bash
sudo sh scripts/export-current-server.sh /opt/auto-video-gen /opt/auto-video-gen-github
```

Copy cac file Docker kit vao `/opt/auto-video-gen-github/`.

Khong dua `.env.local`, API key, `data/`, output, downloads, backups len GitHub.

## Test Docker local

```bash
chmod +x docker/entrypoint.sh scripts/*.sh
./scripts/deploy-build-local.sh
```

Mo `http://IP_SERVER:3080`, vao `Set API` de cau hinh AI/Voice.

## Push GitHub

```bash
git init
git add .
git commit -m "Auto Video Gen 2.0 Docker baseline"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

GitHub Actions se build va push image len GHCR.

## Server Ubuntu moi

Sau khi cai Docker + Git mot lan:

```bash
git clone https://github.com/USERNAME/REPOSITORY.git
cd REPOSITORY
chmod +x scripts/*.sh docker/entrypoint.sh
./scripts/deploy-ghcr.sh
```

## Runtime can backup

- runtime/data: Set API, master key, history/settings
- runtime/downloads: video da xuat
- runtime/output: render workspace
- runtime/branding: logo/avatar

`runtime/data/master.key` rat quan trong. Mat key nay co the lam cac API key da ma hoa khong doc lai duoc.

VieNeu-TTS co the tiep tuc chay o server LAN rieng, vi du `http://192.168.1.154:8000`.
