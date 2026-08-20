# Ads Bot — Telegram Mini App kiếm tiền

Stack: Next.js 14 (App Router) · Prisma + PostgreSQL · Telegraf (webhook mode) · Tailwind

## Cấu trúc quyền quan trọng — đọc kỹ trước khi deploy

- **Không có API nào tin `telegramId` gửi thẳng từ client.** Mọi request đến từ Mini App đều
  mang theo `initData` (chuỗi Telegram Mini App cấp), server tự verify bằng HMAC với `BOT_TOKEN`
  (`lib/verifyInitData.ts`). Đây là điểm bắt buộc — nếu bỏ qua bước này, ai cũng có thể tự xưng
  là user bất kỳ và cộng tiền cho chính họ.
- **Nhiệm vụ không được cộng tiền khi client báo "đã xem xong".** Client chỉ gọi
  `/api/tasks/[id]/claim` để mở đơn `PENDING` + nhận script quảng cáo. Tiền chỉ được cộng khi
  Monetag/Adsterra gọi ngược **postback server-to-server** vào `/api/postback/monetag`
  (có `secret` riêng, không dùng chung với initData). Đây là chỗ chống gian lận cốt lõi bạn nhắc
  tới — thiếu bước này thì user F5 liên tục là fake được nhiệm vụ vô hạn.
- **Rút tiền trừ balance ngay khi tạo lệnh** (chuyển sang `pendingBalance`), tránh việc user bấm
  rút 2 lần cùng lúc rút được gấp đôi số dư trước khi admin kịp duyệt lệnh đầu.

## Cơ chế CPM tự động (Monetag)

- **Monetag dùng 1 main zone duy nhất cho toàn app** (đúng theo tài liệu chính thức — sub-zone chỉ
  dùng nội bộ, không cấu hình riêng cho từng nhiệm vụ). Cấu hình `Monetag Main Zone ID` và
  `Script embed Monetag` (dán nguyên từ dashboard) ở panel **Cài đặt & Hướng dẫn**, dùng chung cho
  mọi nhiệm vụ Monetag.
- Trang Task nạp SDK này **đúng 1 lần** khi mở app (không nạp lại theo từng nhiệm vụ — nạp nhiều
  lần là lỗi phổ biến theo doc Monetag). Khi user bấm "Bắt đầu", client gọi
  `show_<zoneId>({ ymid: requestId })`, `requestId` chính là ID nội bộ để nối lại đúng
  `TaskCompletion` khi postback về.
- Nhiệm vụ bật "CPM tự động" trong panel sẽ **không dùng số tiền cố định** — mỗi 5 phút, cron
  gọi `GET /api/cron/sync-cpm?secret=CRON_SECRET`, lấy CPM hiện tại của zone chung đó từ Monetag,
  rồi tính lại `reward` theo công thức:
  ```
  reward (VND/view) = (cpmUsd / 1000) * tỷ_giá_USD_VND * (marginPercent / 100)
  ```
  Ví dụ CPM $1/1000 view, margin 50% → user nhận 50% doanh thu của 1 view đó.
- Tỷ giá USD→VND lấy tự động từ API tỷ giá công khai (cache 1h), có fallback thủ công ở
  `Setting("usdVndRateManual")` nếu API tỷ giá lỗi.
- **Bắt buộc phải điền phần TODO trong `lib/monetagCpm.ts`** trước khi dùng thật — Monetag không
  có tài liệu Statistics API công khai mà tôi verify được, bạn cần lấy đúng URL báo cáo từ chính
  tài khoản publisher của bạn (Statistics → Export → API), tôi chỉ để sẵn khung gọi + parse.
- **Thiết lập cron trên Railway:** New Service → chọn "Cron Job" (nếu bản Railway bạn dùng có),
  command đơn giản nhất là `curl` gọi endpoint mỗi 5 phút:
  `*/5 * * * * curl -s "https://<APP_URL>/api/cron/sync-cpm?secret=$CRON_SECRET"`
  Nếu không có Cron Job service, dùng dịch vụ ngoài miễn phí như cron-job.org trỏ vào URL trên.
- Lưu ý: **Monetag chỉ cập nhật statistics theo giờ**, nên dù cron chạy mỗi 5 phút, giá trị CPM
  có thể giữ nguyên qua nhiều lần gọi — đúng bản chất dữ liệu, không phải lỗi hệ thống.
- Với các nhiệm vụ **không phải Monetag** (Adsterra/khác), form tạo nhiệm vụ vẫn cho dán script +
  Zone ID riêng, vì các network đó không dùng chung SDK `show_XXX()` này.

## Việc cần làm tiếp (chưa xong 100%, cần bạn hoàn thiện theo network thật)

1. **Adsterra không có postback chuẩn như Monetag** — Adsterra chủ yếu là revenue theo
   impression/CPM, không có "hoàn thành nhiệm vụ" per-user. Nếu dùng Adsterra cho task thưởng cố
   định, cách phổ biến là dùng **rewarded interstitial** của họ + đo qua callback JS `onAdView`
   phía client, kết hợp giới hạn IP/device để giảm gian lận — nhưng đây **không đủ an toàn bằng
   Monetag postback**. Tôi để `adNetwork: "custom"` fallback: nếu chọn "custom"/"adsterra", claim
   route hiện vẫn tạo `PENDING`, bạn cần thêm route xác nhận riêng tương ứng cách network đó cấp
   (search tài liệu network cụ thể bạn được cấp, vì mỗi affiliate có endpoint khác nhau).
2. **Chưa có cron dọn các `TaskCompletion` PENDING quá hạn** (ví dụ Monetag không gọi postback do
   user thoát ngang) — nên thêm 1 route chạy định kỳ (Railway Cron hoặc Vercel Cron) đánh dấu
   `REJECTED` sau X phút không nhận được postback.
3. **Rate limit cho `/api/tasks/[id]/claim`** ở tầng IP chưa có — hiện chỉ chặn theo cooldown/task,
   nên cân nhắc thêm middleware giới hạn request/phút để chặn bot spam claim hàng loạt task.

## Deploy lên Railway

1. Push code lên GitHub.
2. Railway → New Project → Deploy from GitHub → chọn repo.
3. Add plugin PostgreSQL (Railway tự set `DATABASE_URL`).
4. Vào Variables, thêm theo `.env.example` (BOT_TOKEN, APP_URL, ADMIN_IDS, POSTBACK_SECRET).
5. Build command mặc định `npm run build` (đã gồm `prisma generate && prisma db push`).
6. Sau khi deploy xong, gọi 1 lần `GET https://<APP_URL>/api/telegram/webhook` để đăng ký webhook.
7. Vào Telegram, `/start` bot, admin thì `/panel`.
