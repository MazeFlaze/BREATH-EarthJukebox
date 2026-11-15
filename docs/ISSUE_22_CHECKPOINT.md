# Issue #22: checkpoint trước Creator Lite

Theo yêu cầu ngày 2026-11-15, lưu pipeline, audio và tài liệu bằng commit/PR. Người dùng xác nhận **giữ `/demo` local**, không push giao diện. Nhánh: `feat/issue-22-demo-checkpoint`; liên kết [Issue #22](https://github.com/MazeFlaze/BREATH-EarthJukebox/issues/22). Không merge hoặc tự đóng issue.

## Phạm vi được lưu trên Git

- Baseline notebook A: commit tiền đề `9b4ca81` đã có trên máy nhưng chưa có trong `origin/main`. PR #23 đã đóng, chưa merge. PR checkpoint mới cần bao gồm baseline này để các schema, processor, contract, bản đồ và golden PCM được tham chiếu tồn tại đầy đủ.
- NASA CLI hiện có: progress, báo thành công/thất bại, exit status, archive retention rõ ràng, receipt/hash/structure validation và tách fixture khỏi archive. Không chạy download trong phiên triển khai hoặc checkpoint.
- Catalog offline, dedup/conflict/missing, timestamp gaps, per-snapshot JSON/raster và native Float32 cache có nguồn/checksum. Tái dùng bộ đọc và tiền xử lý hiện có; không đổi đơn vị/calibration A.
- Frozen-event audio/traversal, sweep B theo toàn cột/hàng, detail Focus/Native Spectral, AudioWorklet và clock 3/5/7 phút, ROI/voice support.
- Phối khí `context-spatial-pentatonic-v1`: nền Mean, nhấn P90−Mean, IQR và biên từ độ dốc/độ cong. Mean/giá trị gốc không sửa. Top-3/top-2, thang âm, saturation và smoothing là các phép giản lược có công bố.
- Test cases và tài liệu cho các lớp trên. Không thêm dependency hoặc thay lockfile.

## Những gì không có trên Git

`frontend/src/app/demo/`, `frontend/public/data/geos-cf-catalog/`, raw NASA, DB, `.env`, dependency/build directories và `.local-backups/` tiếp tục bị loại trừ. Clone mới **không có route demo** và không tự phát được toàn bộ giao diện local. Đây là giới hạn phân phối được người dùng xác nhận, không phải route đã deploy.

Đã tạo ZIP local trước khi đổi nhánh, gồm 61 file: source đã thay đổi/thêm mới, giao diện demo và catalog đã export. Không có raw NASA, DB, secrets hay dependencies:

```text
.local-backups/issue-22-demo-checkpoint-20261114T225653Z.zip
SHA256 d709efb735514de1b45c76e648de9653444272bb6ea16c29b64a61a7c4d288a7
```

ZIP có `CHECKPOINT_MANIFEST.json`, ghi base commit `9b4ca81`, relative paths và checksum từng file. Đây là snapshot local trước checkpoint, không phải backup remote; sao chép ZIP sang nơi lưu trữ riêng nếu cần dự phòng mất ổ đĩa. Không đưa ZIP vào PR vì chứa route mà người dùng yêu cầu giữ local.

Khôi phục vào thư mục riêng từ baseline nói trên, giải nén theo relative paths rồi đối chiếu manifest. Không giải nén đè working tree đang có thay đổi. Native cache là artifact có thể sinh lại bằng exporter từ raw đã xác minh; không tự tải NASA khi khôi phục.

## Kiểm chứng: lịch sử và lần checkpoint này

- Backend: báo cáo trước checkpoint ghi **89 test đạt** sau phần catalog/detail. Không chạy lại backend suite trong lượt checkpoint.
- Frontend sau phối khí mới: **30 test đạt**, typecheck/lint/build đạt ở lượt triển khai trước. Bao gồm baseline/golden PCM, derivative, mute/solo, missing/zero, deterministic render, seek/reverse/preview và sáu trường NASA ở hai hướng.
- Edge headless trước checkpoint: 20 giây preview đúng clock, pause/resume, truy vết JSON, sáu chất, dọc 16 dải, các chế độ đối chiếu, 3/5/7 phút; desktop/mobile đã kiểm tra. Các đoạn thử không chạm guard; chưa thay cho listening test 3–7 phút trên nhiều thiết bị.
- Người dùng xác nhận cách duyệt đúng yêu cầu và tiếp tục tinh chỉnh chất lượng nghe. Không coi xác nhận này là nghiệm thu toàn bộ N06 hoặc mọi lựa chọn phối khí.
- **Không chạy test, typecheck, build hoặc lint trong lượt checkpoint này**, theo giới hạn người dùng đặt ở lượt Creator Studio. PR để draft và chờ kiểm chứng CI/N06/module owner; kết quả cũ không được ghi là fresh PASS cho commit mới.
- Warning viewport metadata tại root đã tồn tại; checkpoint không sửa unrelated UI.

Dữ liệu thực vẫn chỉ một timestamp độc lập `2026-11-12T00:30:00Z`, source SHA256 `8c041bb77c65fe609bea34a2992e8a9c4c3b7efa7419f4b4acd5cde3e9a78198`. Chưa chạy download archive nhiều giờ. Temporal gaps/delta có test fixture, nhưng nghiệm thu Temporal/Journey với nhiều giờ NASA thật còn chờ người dùng tải thủ công.

## Creator Lite: đã đọc brief, chưa triển khai

Đã đọc toàn bộ brief người dùng cung cấp (518 dòng), lưu bản tham chiếu tại [CREATOR_STUDIO_IMPLEMENTATION_BRIEF.md](CREATOR_STUDIO_IMPLEMENTATION_BRIEF.md). Lượt đó bị ngắt ở khảo sát: **không có code Creator Studio, preset mới hoặc WAV exporter được thêm**. Không gọi checkpoint là đã đạt P0.

Audit đã xác định:

| Phần | Module thật và quyết định tích hợp cần giữ |
| --- | --- |
| Stack/routes | Next.js 14 App Router, React 18, TypeScript, npm/package-lock; `/`, `/landing` và `/demo` local |
| Data pipeline | `NotebookDemoProcessor`, `GEOSCFProvider`, `IngestionService`, catalog/detail exporters; tái dùng thay vì tạo downloader khác |
| Event contract | `breathe-notebook-demo-v1` trong `types/notebookDemo.ts`, snake_case `FrozenEvent` và `scientific`; khác tên schema minh họa `breathe-harmonic-events-v1` trong brief, cần adapter thay vì thay schema |
| Audio | `NotebookDemoAudio`: shared live context, renderDemoPlan/renderFocusPlan, carrier/music bus, generation, pause/resume/stop; `playPrepared` là điểm mở rộng sẵn có |
| Detail branch | `GeosCfStreamAudio`/AudioWorklet/DetailSynth là mapping liên tục riêng; phối khí context mặc định có referenceGain=0 và có lượng tử hóa/chọn lọc. Không tự nhận là pulse carrier invariant theo brief Creator Lite |
| Map/timeline | Local BaselineDemo/ComparisonDemo dùng SVG bounds và canonical event; DetailDemo dùng Canvas + thanh quét. Không viết lại map chỉ để thêm Creator |
| API | Generic `docs/DATA_CONTRACT.md` chủ yếu AOD/CO2/CH4, không dùng nhầm cho six AQC. P0 dựa contract six-pollutant thật, không bịa API WAV/share |

P0 được đồng ý làm tiếp: thin Create panel; ít nhất 3 presets/2 voices; tempo và layers có tác dụng thật; độc lập data/music gain; Data-only/Back to Scientific; giải thích event/source/mapping; WAV và recipe JSON dùng cùng timeline/render semantics. Giữ canonical IDs, units, scores, pulses, source SHA và chronological metadata. Không ép progression/chord baseline vào C pentatonic của detail context. Không sửa dữ liệu nguồn hoặc bật Temporal khi thiếu timestamp thật.

Hướng nhỏ nhất để đánh giá trước khi sửa: adapter preset/renderer vào frozen events và `NotebookDemoAudio.playPrepared`, dùng renderer chung cho live/export, giữ nguyên các route cũ. Offline export cần giới hạn duration/memory, version/hash/provenance và xử lý lỗi thật. Việc chọn điểm tích hợp cuối cùng cần khảo sát tiếp, không xem đây là quyết định đã triển khai. P1 WebM và P2 public share/remix chưa làm; không tạo API hoặc nút share giả.

## Kiểm tra thủ công trên máy hiện tại

1. Giữ nguyên `/demo` local; khởi động frontend theo hướng dẫn ở [DETAIL_DEMO_3_5_7_MINUTES.md](DETAIL_DEMO_3_5_7_MINUTES.md). Phiên production trước checkpoint dùng `http://127.0.0.1:3101/demo`; phải build lại khi muốn nạp code mới vào production, và việc chạy check cần được người dùng cho phép.
2. Chọn PM2.5, native, ngang, 8 dải, 5 phút; bấm nghe thử 20 giây. Thử pause/resume/seek/reverse và xác nhận vị trí bản đồ theo clock.
3. Chọn phối khí mới, solo/mute từng lớp và nghe Scientific/Harmonic legacy để so. Reference mix về 0 khi solo nhạc. Kiểm tra truy vết/source hash và đuôi âm ngắn.
4. Thử đủ sáu chất, dọc 16 dải, grid thô/native, ROI một điểm và 3/5/7 phút. Không suy ra AQI hoặc nguy hại giữa các chất từ loudness.
5. Chỉ sau khi tự tải NASA và export catalog, kiểm tra playlist/Temporal với nhiều timestamp thật, missing hour và delta sau gap. Không dùng fixture để giả nghiệm thu archive NASA.
6. Trước merge: được phép chạy checks trên commit thực tế; xem CI và review N06/module owner. Issue #22 còn mở cho nghiệm thu và Creator Lite.
