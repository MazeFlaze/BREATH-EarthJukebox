# Issue #22 — bản triển khai local để kiểm tra

> Demo mới nhất mặc định là grid chi tiết, Focus/Native Spectral và 3/5/7 phút; xem [DETAIL_DEMO_3_5_7_MINUTES.md](DETAIL_DEMO_3_5_7_MINUTES.md). Các bản A/B 32 vùng bên dưới được giữ trong tab đối chiếu.

> Cập nhật theo lựa chọn B của người dùng: ngang/dọc mặc định dùng thanh quét với các voice đồng thời, mapping riêng; xem [SWEEP_B_LOCAL_DEMO.md](SWEEP_B_LOCAL_DEMO.md). Các mô tả quét zíc zắc và carrier giống A bên dưới áp dụng cho chế độ đối chiếu từng ô.

Trạng thái checkpoint 2026-11-15: theo yêu cầu mới, lưu pipeline/audio/tài liệu trên nhánh `feat/issue-22-demo-checkpoint` và liên kết Issue #22; không đóng issue hoặc tự merge. Người dùng xác nhận tiếp tục giữ giao diện `/demo` local. Route `frontend/src/app/demo/` và catalog sinh ra trong `frontend/public/data/geos-cf-catalog/` đều được ignore. Máy clone repo mới sẽ không có giao diện `/demo`. Xem [ISSUE_22_CHECKPOINT.md](ISSUE_22_CHECKPOINT.md) về phạm vi lưu, bản backup local, bằng chứng kiểm chứng cũ và bước Creator Lite tiếp theo.

Tài liệu này mô tả bản nâng cấp #22. [Tài liệu demo A và hướng B](NOTEBOOK_DEMO_A_AND_DIRECTION_B.md) giữ phần đối chiếu notebook và thiết kế calibration B.

## Dữ liệu hiện có

Kiểm kê local ngày 2026-11-15, các thư mục `D:/MY LESSON/NASA/demo`, `backend/src/data/raw`, `backend/src/data/nasa-archive`:

| Nhóm | Số file | Xử lý |
| --- | ---: | --- |
| Snapshot đủ điều kiện | 1 | Phát được, `2026-11-12T00:30:00Z` |
| Bản sao cùng SHA256 | 1 | Không tính thành thời điểm khác |
| Synthetic / fixture / không đủ lưới toàn cầu | 3 | Không được đưa vào playlist |

Hash nguồn thật: `8c041bb77c65fe609bea34a2992e8a9c4c3b7efa7419f4b4acd5cde3e9a78198`. Snapshot có đủ sáu chất, lưới 721 × 1440. Việc repo có script tải NASA không có nghĩa các giờ đã được tải thành công. **Chưa chạy download trong lần triển khai này.**

## Dùng lại phần tiền xử lý

- Downloader vẫn là `GEOSCFProvider` và `IngestionService`, CLI vẫn là `backend/scripts/ingest_geos_cf.py --source nasa`.
- Catalog đọc NetCDF bằng `NetCDFProcessor.open_dataset`, dùng `NotebookDemoProcessor.prepare_fields/build` cho cleaning, đổi đơn vị, mean vùng có trọng số cos(vĩ độ), score/xung và frozen plan A. Không thay mean vùng bằng sample ở điểm preset trong DB.
- P90 và IQR tính trên các ô hợp lệ, **không có trọng số**. Coverage lấy từ số ô hợp lệ/tổng số ô. Giá trị thiếu, âm và sentinel bị loại theo policy notebook hiện có trước khi tính feature.
- Mean, score và carrier A giữ calibration `multi6-fixed-demo-v1-NOT-AQI`. CO hiển thị ppmv; NO₂/O₃/SO₂ hiển thị ppbv; tiền xử lý vẫn nhận khí ở mol/mol.
- Catalog và snapshot có schema Pydantic v2 riêng. Raster giữ cùng display scale qua các thời điểm. JSON và PNG được export từ raw local; mở trang không gọi NASA.

## Download thủ công

Chạy từ **root repo**, trong terminal riêng. Các lệnh dưới đây dành cho người dùng chạy. Cần môi trường `backend/.venv` có dependencies của repo và truy cập NCCS qua HTTPS. Khoảng nghiên cứu gồm 24 mốc hourly mean ở `HH:30 UTC`, tính cả hai đầu mút.

```powershell
$env:DEBUG = 'false'
$env:DATABASE_URL = 'sqlite:///src/data/nasa-archive-study.db'
$archiveDir = Join-Path (Get-Location).Path 'backend/src/data/nasa-archive/2026-11-12'

# Chỉ in kế hoạch 24 giờ, không download hay ghi DB:
backend/.venv/Scripts/python.exe backend/scripts/ingest_geos_cf.py `
  --source nasa --archive-dir "$archiveDir" --retention preserve `
  --start '2026-11-12T00:30:00Z' --end '2026-11-12T23:30:00Z' `
  --variables PM25_RH35 PM10_RH35 CO NO2 O3 SO2 --dry-run

# Khi muốn bắt đầu tải, tự chạy lệnh này:
backend/.venv/Scripts/python.exe backend/scripts/ingest_geos_cf.py `
  --source nasa --archive-dir "$archiveDir" --retention preserve `
  --start '2026-11-12T00:30:00Z' --end '2026-11-12T23:30:00Z' `
  --variables PM25_RH35 PM10_RH35 CO NO2 O3 SO2

$LASTEXITCODE
```

CLI in `[n/24]`, số MiB và phần trăm khi server gửi Content-Length. Cuối lượt có `requested/succeeded/failed`; bất kỳ giờ nào thất bại đều trả exit code 1. Có thể chạy lại cùng lệnh: chỉ tái dùng file cache khi cấu trúc, URL nguồn, timestamp, size và SHA256 khớp receipt. File hỏng hoặc file cũ không có receipt sẽ được tải lại, không tự chứng nhận bằng tên file.

`--retention preserve` là mặc định cho CLI NASA và không evict archive sau giờ thứ 10. Muốn giới hạn dung lượng phải chọn rõ `--retention bounded --max-raw-files N`; file bị evict không còn phát được. Receipt còn lại giúp catalog báo `missing`. API/provider thông thường vẫn giữ giới hạn cache hiện có. CLI không bootstrap fixture từ thư mục raw vào DB archive; pytest dùng raw/archive/SQLite trong thư mục tạm riêng.

Receipt `<file>.nc4.source.json` ghi URL HTTPS NCCS, thời điểm, size, hash và thời gian tải. Đây là chứng cứ pipeline local và kiểm tra toàn vẹn, **không phải chữ ký số NASA**. Catalog yêu cầu receipt khớp hoặc hash nguồn notebook đã biết; nhãn `institution=NASA`, kích thước hay tên file không đủ. Hai hash đã được chấp nhận nhưng cùng timestamp bị đưa vào `conflict`, không tự chọn revision.

## Export catalog sau khi tải

Chạy từ root repo. Lệnh này chỉ đọc file local và sinh JSON/PNG, không download hay ghi dữ liệu vào DB:

```powershell
$env:DEBUG = 'false'
backend/.venv/Scripts/python.exe -m backend.scripts.export_geos_cf_catalog `
  --raw-dir 'backend/src/data/nasa-archive' `
  --raw-dir 'backend/src/data/raw' `
  --raw-dir 'D:/MY LESSON/NASA/demo'
```

`--raw-dir` lặp lại để chỉ định các thư mục cần kiểm kê, bao gồm thư mục con. Nếu không truyền, exporter quét `NASA_ARCHIVE_ROOT` và `DATA_STORAGE_ROOT` (không tự tìm thư mục notebook ngoài repo). Không truyền EDA generator thay cho dữ liệu download thất bại.

Mỗi source hash có một snapshot và sáu raster. Export lại sẽ tái dùng cache hoàn chỉnh, có schema/version và source hash khớp; index được ghi bằng file tạm rồi replace. File cũ không còn trong raw không được index mới đưa vào phát, dù JSON cũ còn trên đĩa. Cần export lại và reload trang sau khi tải/xóa file; catalog không phải file watcher.

## Chạy và kiểm tra giao diện local

```powershell
cd frontend
npm.cmd run dev
```

Mở `http://localhost:3000/demo`. Server kiểm tra trong phiên triển khai dùng `http://127.0.0.1:3100/demo` vì cổng 3000 báo `EACCES` trên máy này; có thể chạy `npm.cmd run dev -- --hostname 127.0.0.1 --port 3100` nếu cần.

Chọn đủ sáu chất, snapshot riêng cho Global/Region; chọn khoảng UTC và checkbox playlist cho Temporal/Journey. Trang không tự phát audio. Đổi chất/profile/đường duyệt/lựa chọn sẽ dừng audio và hủy lượt chuẩn bị cũ. Chọn ô để seek, rồi Play; Pause/Resume dùng audio clock. Master và music mix độc lập.

| Chế độ | Ý nghĩa một bước | Thiếu dữ liệu / giới hạn |
| --- | --- | --- |
| Global Scan | Một trong 32 vùng cố định ở một snapshot | Các đường duyệt chỉ thay thứ tự |
| Region A/B | Hai bbox cố định mẫu Việt Nam trong notebook | Không phải ranh giới hành chính |
| Temporal | Cùng Gxx hoặc cùng A/B ở các giờ UTC | Cần ≥2 snapshot chọn; tối đa cửa sổ 48 giờ; giờ không có trong lựa chọn thành gap/cue, không nội suy |
| Archive Journey | 32 vùng mỗi snapshot, lần lượt qua playlist trong khoảng chọn | Nạp và render một snapshot mỗi lượt; giờ không có file bị bỏ qua và được liệt kê trong kiểm kê; không giả vờ mỗi bước là một giờ |

Browser cache giữ tối đa 3 snapshot. Temporal chỉ giữ event của một vị trí, không giữ toàn bộ raster/plan archive. Đổi lựa chọn hoặc Stop làm generation cũ mất hiệu lực; request đang đọc có thể hoàn tất nhưng không tự phát lại. Temporal không hiện raster của một giờ khác dưới timestamp đang phát; bản đồ khi đó chỉ minh họa vị trí cố định.

Các đường ngang/dọc là serpentine. Vòng gồm hai vành chữ nhật trên lưới 4 × 8 EPSG:4326, tâm nhìn thấy (0°, 0°); chiều CW/CCW độc lập với ngoài→trong/trong→ngoài. Đầu vào/ra vòng chọn ô nối liền kề. Đây là hình học trên bản đồ kinh/vĩ độ, không phải đường tròn theo khoảng cách địa cầu hay spiral geodesic. Đảo phát lại chỉ đảo sequence. Cell IDs, source-qualified event IDs, bounds, giá trị, chất lượng, units, score và pulse count không bị đánh lại. Mood/chord A đã freeze theo canonical order, không re-freeze theo đường mới.

## Harmonic Focus và ghi chú hướng B

Profile **A · Notebook baseline** vẫn tái lập mapping gốc. Profile **Focus** dùng mapping nghệ thuật riêng `focus-artistic-log99-v1`, không tạo calibration nồng độ mới. Với score A `s`, lens cố định là `log(1 + 99s) / log(100)`. Không lấy quantile/P99 riêng từng frame để kéo giãn âm thanh.

| Stem / thuộc tính | Dữ liệu điều khiển | Điều giữ cố định |
| --- | --- | --- |
| Lead | Pitch liên tục trong 24 bán âm theo lens(score nồng độ) | Register riêng cho mỗi chất; không tiến triển theo index |
| Pad | Độ sáng harmonic theo lens(IQR / audio_max A) | Voicing xác định từ score, không có path hysteresis mới |
| Bass | Độ ngắn/dài theo tương phản | Register riêng theo chất |
| Texture | 1–4 hit và biên độ theo lens(tương phản) | PRNG deterministic theo chất + cell ID; không random mỗi lần nghe |
| Pan | Kinh độ tâm vùng | Không đổi khi reverse/seek |

Global dùng tương phản với mean score của các ô láng giềng cố định, wrap theo kinh độ; Region A/B giữ contrast 0 vì chưa định nghĩa neighborhood cho hai bbox đó. Temporal dùng trị tuyệt đối delta **chronological** giữa hai giờ liền kề, chia audio_max A. Giờ đầu hoặc sau gap có delta `null`, không tính xuyên gap. Reverse giữ nguyên dấu delta đã tính theo thời gian tăng dần. P90 và coverage là thống kê hiển thị; không giả vờ mọi feature đều có stem riêng.

Focus có gain 0–1, mute và solo riêng cho bốn stem. Scientific mode tắt bus music; stem solo không tắt carrier. Carrier sample-for-sample giống A. Headroom được kiểm tra theo tổng trị tuyệt đối của carrier và từng stem ở gain tối đa, nên các tổ hợp mute/solo không làm tăng quá bound; không normalize lại carrier để tránh clipping.

CO/NO₂/SO₂ trong snapshot hiện tại vẫn có một pulse ở cả 32 ô do A lượng tử hóa thô. Focus giữ score chưa lượng tử hóa để pitch còn thay đổi, không suy ra rằng xung mới có nhiều mức hơn. Nghe phân biệt được bao nhiêu vẫn cần đánh giá trên tai nghe/loa và dữ liệu thật nhiều giờ; kiểm tra số học không thay thế listening test.

**Nếu làm hướng B:** đợi người dùng tải và xác minh nhiều timestamp, dùng tập calibration/holdout rõ ràng gồm đủ PM10, lưu manifest hashes/units/window/method/thresholds và version riêng; đánh giá occupancy, saturation và độ nhạy. Không đổi ngưỡng A hay nhận log99 của Focus là calibration khoa học. Ensemble chỉ đánh giá sau phản hồi Focus: tách voice từng chất, không cộng nồng độ khác đơn vị thành risk score chung. Worker/render block và API vùng tùy ý là bước tiếp theo nếu profiling thực tế yêu cầu.

## Kiểm chứng và phần cần người dùng nghiệm thu

- Backend: pytest gồm baseline và test mới về receipt/hash, grid/unit/time, dedup/conflict/missing, progress, archive preservation, cache không hợp lệ, tải thất bại/exit code, UTC range và gap/export cache.
- Frontend: baseline PCM golden probes, traversal đủ 32 ô duy nhất và cạnh kề, Focus carrier/headroom/determinism, stem controls, reverse/seek, Temporal gap/delta, lazy cache và hủy generation; `typecheck`, `lint`, `build`.
- HTTP smoke: `/demo`, catalog, snapshot và PNG trả 200. Warning viewport metadata có sẵn ở root layout vẫn xuất hiện khi build.
- Smoke trên snapshot NASA thật xác nhận toàn bộ `global_plans` giống baseline. Dải pitch Focus giữa 32 vùng: PM2.5 12,306; PM10 10,602; CO 5,337; NO₂ 7,107; O₃ 4,561; SO₂ 6,479 bán âm. Bound peak mọi stem bật nằm 0,1811–0,2246, dưới 0,93. Đây là kiểm tra số học, chưa phải kết luận chất lượng nghe.
- Chưa đánh dấu hoàn tất N06: công cụ browser/computer-use báo lỗi khởi tạo `failed to write kernel assets`, nên chưa xác nhận trực tiếp thao tác, layout mobile/keyboard hoặc nghe trên thiết bị. Dữ liệu thật mới chỉ một timestamp; Temporal/Journey nhiều giờ đã kiểm tra bằng unit fixture, chưa nghiệm thu bằng archive NASA nhiều giờ.

Gợi ý kiểm tra thủ công: so A/Focus từng chất; giữ nguyên ô rồi bật/tắt từng stem, kéo music mix về 0; đổi ngang/dọc/vòng và kiểm tra Gxx/giá trị không đổi; reverse/seek, stop lúc chuẩn bị, pause/resume; thử Tab/Enter/Space và màn hình hẹp. Sau khi download/export, chọn playlist có giờ bị bỏ trống để kiểm tra cue và delta `—` sau gap. Ghi phản hồi về chi tiết nghe được và lớp nào đang che carrier trước khi chọn tiếp calibration B hoặc Ensemble.
