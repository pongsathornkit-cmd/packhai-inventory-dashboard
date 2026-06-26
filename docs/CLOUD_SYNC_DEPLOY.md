# Cloud Sync Deployment

เป้าหมายคือย้ายตัว Sync server ออกจากเครื่องทำงานหลักไปอยู่บน cloud/VPS ที่เปิดตลอด
เพื่อให้กด Sync จากเครื่องไหนก็ได้

## Architecture

- GitHub Pages: หน้า report online เดิม
- Cloud/VPS Sync Server: รัน `npm start`, รับคำสั่ง `/api/sync/*`, ดึง Packhai/FlowAccount/Shopee/Lazada, build dashboard
- Persistent storage: เก็บ `data/` และ `browser-profiles/` เพื่อให้ข้อมูลและ login session อยู่ข้าม restart

## Required Secrets

ตั้งค่าเป็น environment variables บน cloud/VPS:

- `SYNC_API_KEY`: รหัสที่หน้าเว็บต้องใส่ก่อนกด Sync
- `PACKHAI_AUTH_TOKEN`: token สำหรับดึง stock จาก Packhai
- `PUBLIC_SYNC_API_BASE`: URL public ของ cloud sync server เช่น `https://packhai-sync.example.com`
- `GITHUB_TOKEN`: GitHub token ที่ push กลับ repo ได้ ใช้ publish dashboard กลับ GitHub Pages หลัง Sync
- `SYNC_ALLOWED_ORIGINS`: optional, comma-separated origins เพิ่มเติม เช่น `https://example.com`

## Browser Session

FlowAccount, Shopee Seller และ Lazada Seller ใช้ browser profile:

- `FLOW_PROFILE`
- `SHOPEE_SESSION_DIR`
- `SELLER_SESSION_DIR`

ถ้า profile ยังไม่ได้ login บน cloud งานส่วนนั้นจะขึ้น warning และใช้ข้อมูลล่าสุดที่มีอยู่แทน
ต้อง login หนึ่งครั้งบน cloud/VPS เพื่อให้ Sync ราคา/stock จากระบบที่ใช้ session ได้เต็มรูปแบบ

## Recommended Hosting

ทางที่เสถียรที่สุดคือ Windows VPS หรือ Linux VPS ที่มี persistent disk และสามารถเปิด Chrome login ได้
ถ้าใช้ Render ต้องใช้ paid web service พร้อม persistent disk เพราะ free/ephemeral filesystem จะเก็บ session ไม่อยู่

## Docker

```bash
docker compose up -d --build
```

เปิดเว็บที่ `http://SERVER_IP:8123` หรือผูก domain/reverse proxy เป็น HTTPS

## Render Blueprint

ไฟล์ `render.yaml` เตรียม web service แบบ Docker พร้อม persistent disk ไว้แล้ว
เปิด Blueprint จาก repo นี้ใน Render แล้วเติม secrets ด้านบน

หลัง deploy ได้ URL จริงแล้ว ให้นำ URL นั้นไปใส่ `PUBLIC_SYNC_API_BASE`
และ rebuild/publish dashboard เพื่อให้ GitHub Pages ยิงปุ่ม Sync ไปหา cloud server แทนเครื่อง local
