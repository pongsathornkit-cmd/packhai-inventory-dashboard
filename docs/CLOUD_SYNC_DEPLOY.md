# Cloud Sync Deployment

เป้าหมายคือย้ายตัว Sync server ออกจากเครื่องทำงานหลักไปอยู่บน cloud/VPS ที่เปิดตลอด
เพื่อให้กด Sync จากเครื่องไหนก็ได้

## Architecture

- GitHub Pages: หน้า report online เดิม
- Cloud/VPS Sync Server: รัน `npm start`, รับคำสั่ง `/api/sync/*`, ดึง Packhai/FlowAccount/Shopee/Lazada, build dashboard
- Persistent storage: เก็บ `data/`, `auth-states/` และ `browser-profiles/` เพื่อให้ข้อมูลและ login session อยู่ข้าม restart

## Required Secrets

ตั้งค่าเป็น environment variables บน cloud/VPS:

- `PACKHAI_AUTH_TOKEN`: token สำหรับดึง stock จาก Packhai
- `PUBLIC_SYNC_API_BASE`: URL public ของ cloud sync server เช่น `https://packhai-sync.example.com`
- `GITHUB_TOKEN`: GitHub token ที่ push กลับ repo ได้ ใช้ publish dashboard กลับ GitHub Pages หลัง Sync
- `SHOPEE_STORAGE_STATE_B64`: storage state จาก Shopee Seller Center
- `LAZADA_STORAGE_STATE_B64`: storage state จาก Lazada Seller Center
- `FLOWACCOUNT_STORAGE_STATE_B64`: storage state จาก FlowAccount
- `SYNC_ALLOWED_ORIGINS`: optional, comma-separated origins เพิ่มเติม เช่น `https://example.com`
- `SYNC_REQUIRE_KEY`: ตั้งเป็น `0` เพื่อให้กด Sync โดยไม่ต้องใส่รหัส

## Browser Session

FlowAccount, Shopee Seller และ Lazada Seller ใช้ browser auth state:

- `FLOW_PROFILE`
- `SHOPEE_SESSION_DIR`
- `SELLER_SESSION_DIR`
- `FLOWACCOUNT_STORAGE_STATE_B64`
- `SHOPEE_STORAGE_STATE_B64`
- `LAZADA_STORAGE_STATE_B64`

บน cloud แนะนำให้ใช้ Playwright storage state แทนการย้าย Chrome profile ทั้งก้อน เพราะไฟล์ profile จาก Windows
อาจติด OS encryption และมีขนาดใหญ่มาก

บนเครื่องที่ login Seller/FlowAccount อยู่แล้ว ให้ export storage state:

```bash
npm run auth:export
```

คำสั่งนี้จะสร้างไฟล์ลับใน `.tmp/render-auth-state.env` และไฟล์ JSON ใน `storage-states/`
ซึ่งถูก ignore จาก git แล้ว ห้าม commit ไฟล์เหล่านี้

นำค่าจาก `.tmp/render-auth-state.env` ไปใส่เป็น Render environment variables:

- `SHOPEE_STORAGE_STATE_B64`
- `LAZADA_STORAGE_STATE_B64`
- `FLOWACCOUNT_STORAGE_STATE_B64`

หรือรวม env ทั้งหมดสำหรับ cloud เป็นไฟล์เดียว:

```bash
npm run cloud:env -- --public-sync-api-base https://YOUR-SYNC-SERVER
```

คำสั่งนี้จะสร้าง `.tmp/cloud-sync.env` จาก token/session local และไม่แสดงค่าลับบนหน้าจอ
ไฟล์นี้มี secrets เต็ม ห้าม commit หรือส่งใน chat

ถ้า storage state หมดอายุ งานส่วนนั้นจะขึ้น warning และใช้ข้อมูลล่าสุดที่มีอยู่แทน
ต้อง export ใหม่เมื่อ session ของ platform หมดอายุ

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

บน Render มี `RENDER_EXTERNAL_URL` ให้อัตโนมัติ ถ้าไม่ได้ใส่ `PUBLIC_SYNC_API_BASE`
ระบบ build จะใช้ `RENDER_EXTERNAL_URL` เป็น Sync API URL แทน

หลัง Render/VPS live แล้ว ให้ผูก URL กลับเข้า GitHub Pages ด้วยคำสั่ง:

```bash
npm run sync:configure-api -- --base https://YOUR-SYNC-SERVER --require-ready --publish
```

คำสั่งนี้จะตรวจ `https://YOUR-SYNC-SERVER/api/health` และ `/api/sync/status`
ถ้า backend ยังขาด config จะหยุดพร้อมรายชื่อ `missingConfig`
ถ้าพร้อมแล้วจะเขียน `.sync-api-base.local`, rebuild dashboard และ publish กลับ GitHub Pages ให้ปุ่ม Sync ยิงไปหา backend ถาวร

ตรวจ readiness หลัง deploy:

```bash
curl https://YOUR-SYNC-SERVER/api/health
curl https://YOUR-SYNC-SERVER/api/sync/status
```

ถ้า `ready` เป็น `false` ให้ดู `missingConfig` แล้วเติม environment variables ที่ขาดใน Render
