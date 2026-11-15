# Demo A — GEOS-CF sáu chất: Scientific / Harmonic

> Bản nâng cấp local của issue #22, hướng dẫn download/export hiện hành và ghi chú Focus/B được mô tả tại [ISSUE_22_LOCAL_DEMO.md](ISSUE_22_LOCAL_DEMO.md). Các đoạn mô tả giới hạn một snapshot và CLI cũ bên dưới là bối cảnh baseline A; dùng tài liệu mới khi thử giao diện local hiện tại.

## Phạm vi đã thống nhất

Theo yêu cầu cập nhật của người dùng, giao diện route **`/demo` chỉ giữ local**, trong thư mục `frontend/src/app/demo/` đã được ignore và không nằm trong commit. Repo vẫn chứa producer, schema, audio engine, kiểm thử, JSON và sáu PNG dùng chung. Clone repo mới sẽ không có route `/demo`.

Các mô tả giao diện và bước kiểm tra `/demo` dưới đây áp dụng cho bản local của tác giả. Dashboard `/`, landing `/landing`, API và calibration mặc định của repo giữ nguyên. Đây là baseline A để đối chiếu notebook, chưa áp dụng calibration B.

- Sáu chất: PM2.5 RH35, PM10 RH35, CO, NO₂, O₃, SO₂.
- Global scan: 32 vùng 45° × 45°, thứ tự serpentine Bắc → Nam, xen kẽ Tây → Đông / Đông → Tây.
- Region A/B: hai bbox mẫu Việt Nam trong notebook; không đại diện ranh giới hành chính.
- Scientific và Harmonic, play/pause/resume/stop, chọn vùng/seek, reverse, master volume và music gain riêng.
- Temporal bị vô hiệu hóa, có giải thích: chỉ một timestamp được đóng gói. Không dựng chuỗi NASA từ dữ liệu synthetic.
- Không tự phát âm thanh; chỉ khởi tạo AudioContext sau thao tác người dùng.

## Chạy demo

```powershell
cd frontend
npm ci
npm run dev
```

Mở **http://localhost:3000/demo** trên máy còn giữ thư mục route local. Clone repo mới không có trang này. Không cần backend, tài khoản NASA, CDN hay bản đồ online. “Offline” ở đây nghĩa là sau khi dependencies được cài và Next.js được chạy hoặc build; chưa có service worker để mở ứng dụng khi web server hoàn toàn không hoạt động.

Thử PM2.5 → chọn G12 → Play → Harmonic → giảm music gain về 0 → Reverse → Pause/Resume. Các giá trị/mood/nốt của từng Gxx giữ nguyên. Đổi chất hoặc data mode sẽ dừng âm thanh để người dùng chủ động phát lại.

## Dữ liệu và provenance

- Notebook nguồn: `BREATHE_GEOS_CF_v2_Six_Pollutants_Scientific_Harmonic_RnD_Web_Guide.ipynb`, các cell 4/10/12/16/47/90–110.
- Asset: `GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261112_0030z.R0.nc4`.
- Thời gian: `2026-11-12T00:30:00Z`; lưới `721 × 1440`.
- SHA-256: `8c041bb77c65fe609bea34a2992e8a9c4c3b7efa7419f4b4acd5cde3e9a78198`.
- URL nguồn do notebook cung cấp: https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana/Y2026/M11/D12/GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261112_0030z.R0.nc4

Hash của file local đã được tính lại và khớp artifact notebook. Điều này kiểm tra sự nhất quán file–artifact, không chứng nhận độc lập nguồn tải. Producer yêu cầu khai báo `--data-mode`; với NASA phải có URL NCCS. Synthetic được xuất `isMock: true` và giao diện hiển thị rõ.

GEOS-CF là **model analysis**, không phải phép đo trạm mặt đất. Sáu chất AQC không có AOD. Không chuyển score/mood thành AQI hay mức nguy hại. Hình trong demo do nhóm dựng từ GEOS-CF 2026, không phải frame SVS 5533 năm 2024.

## Tái sử dụng tiền xử lý trong repo

Luồng thực thi:

```text
File NetCDF local
  → IngestionService.calculate_sha256 (hàm hash có sẵn)
  → NetCDFProcessor.open_dataset (reader có sẵn)
  → NotebookDemoProcessor (chính sách tương thích notebook A)
  → NotebookDemoContract.model_validate / model_dump_json
  → contract.json + sáu raster PNG
  → renderDemoPlan / NotebookDemoAudio
  → /demo: bản đồ + thông số + âm thanh theo cùng event
```

Producer không ingest lại vào DB và không thay thế mẫu dữ liệu preset. `observation_samples` đang lưu **điểm**, nên không thể dùng các điểm đó như trung bình diện tích vùng. Demo dùng asset thô qua reader hiện có rồi tổng hợp đúng bbox; có thể cấp asset đã ingest bằng đường dẫn storage của nó.

Các file thêm:

| File | Vai trò |
|---|---|
| `backend/src/processors/notebook_demo_processor.py` | Metadata, mask, weighted aggregation, score/pulses và frozen plans |
| `backend/src/api/schemas/notebook_demo_schema.py` | Pydantic v2, nullable data, từ chối NaN/Inf, version/provenance |
| `backend/scripts/export_notebook_demo.py` | CLI xuất lại dữ liệu; tùy chọn so sánh notebook oracle |
| `frontend/public/data/notebook-demo/` | JSON và raster local dùng bởi demo |
| `frontend/src/types/notebookDemo.ts` | Contract TypeScript riêng, không ép vào legacy Observation |
| `frontend/src/services/notebookDemoAudio.ts` | DSP và transport theo đồng hồ AudioContext |
| `frontend/src/app/demo/` (local-only, ignored) | Giao diện và bản đồ có phép chiếu xác định; không phân phối qua Git |
| `backend/tests/test_notebook_demo.py` | Kiểm thử chính sách khoa học A |
| `frontend/scripts/notebook-demo.test.cjs` | Kiểm thử DSP/transport, golden PCM từ notebook |

CI frontend được bổ sung `npm run test:demo`; dependency cache local được ignore trong `.gitignore`. Không thêm dependency runtime mới.

Test DB-first cũ trong `test_subissue14_m4.py` được sửa dùng `patch.object(NetCDFProcessor, ...)` thay cho hai đường dẫn module cứng; tránh lỗi import khi chạy từ thư mục backend như CI. Không thay thuật toán production để xử lý lỗi test này.

Nhánh làm việc: `feat/notebook-harmonic-demo`, tạo từ `origin/main` sau PR #20. Không commit raw NetCDF hoặc DB. Không publish/merge tự động; quy trình PR vẫn cần review của N06/module owner theo repo.

## Chính sách A được giữ cố định

1. Xác minh đủ sáu biến, units, singleton time/lev, lưới chung, tọa độ tăng dần và timestamp khớp tên file. Nếu đơn vị explicit mâu thuẫn, dừng thay vì dùng mô tả để che mâu thuẫn.
2. Decode CF qua reader, loại NaN/Inf, `abs(value) >= 1e14`, số âm; không điền missing bằng zero. Đây là chính sách demo đã chọn, không khẳng định mọi số âm của mọi sản phẩm đều sai vật lý.
3. Bụi giữ µg/m³; CO dùng **ppmv ×10⁶**; NO₂/O₃/SO₂ dùng **ppbv ×10⁹**. Thang CO của API khác không được ghép trực tiếp với ngưỡng 2 ppmv.
4. Bbox dùng tâm ô `[min,max)`; dải cực Bắc bao gồm 90°. Mean dùng trọng số `cos(latitude)` trên ô hợp lệ. Bbox rỗng trả missing, không tự lấy nearest point. Rendering không thay đổi dữ liệu tính toán.
5. `score = clip(value/audio_max, 0, 1)`. PM2.5: 100; PM10: 150; CO: 2; NO₂: 80; O₃: 100; SO₂: 50, với đúng đơn vị ở trên. Giá trị vật lý không bị clip. Không dùng lại `normalizedValue` log-scale của API cho baseline này.
6. `pulses(None)=None`, `pulses(0)=0`, `pulses(x>0)=ceil(5*score)`.
7. Mood boundaries 0.25/0.50/0.75, hysteresis 0.035; missing reset state. Region A và B freeze độc lập. Chord/melody/bass theo notebook; không tính lại khi reverse/seek. `delta_canonical_score` là chênh score trong thứ tự không gian chuẩn, không phải biến thiên thời gian.

Ví dụ PM2.5 = 30 µg/m³: notebook score **0.3 → 2 xung**; fixed-range 0–250 của API là 0.12; calibrated log của repo khoảng 0.7075. Trộn các score đó sẽ làm thay đổi ý nghĩa và mood.

## Âm thanh và tính tương đương

Carrier: 440 Hz, gain 0.16, xung 68 ms, attack 12 ms/release 40 ms. Missing: hai xung 165 Hz, 75 ms, gain 0.112. Mỗi event dài 0.9 s. Carrier stereo giống nhau hai kênh.

Harmonic = carrier + lớp bass/pad/melody/texture, music gain 0.70 theo notebook. Không peak-normalize riêng từng mode. Master volume chung mặc định 55%; music slider chỉ đổi nhánh nhạc. Headroom được kiểm tra trước khi phát (`peak < 0.93`), không thay thế đánh giá mức âm ngoài thiết bị thực tế.

Browser render PCM từ frozen plans ở 22.050 Hz rồi phát bằng native Web Audio `AudioBufferSourceNode`; thiết bị có thể resample. Không dùng React hoặc setTimeout để đặt lịch từng nốt. UI đọc tiến độ từ audio clock. Stop/seek hủy generation cũ; pause lưu offset; resume tiếp tục offset. Transport thêm fade 12 ms ở điểm bắt đầu/dừng để giảm click; phép so sánh PCM bên dưới áp dụng cho buffer render trước envelope transport và master volume.

Các khác biệt có chủ đích của bản web:

- Contract riêng bổ sung source-qualified event IDs để không trùng giữa snapshot; không đổi scientific values hoặc quyết định nốt.
- Seeded texture được tạo bằng NumPy ở producer và đóng gói theo event. Browser không thay bằng `Math.random()`.
- Preview trong notebook chỉ có tám event Global/chất; demo phát được đủ 32 event vì frozen plans có đầy đủ.
- Hòa âm giữa các event và stereo lead parity phụ thuộc chuỗi playback giống renderer notebook. Seek/reverse giữ event/nốt; không hứa toàn bộ PCM bản nhạc không đổi khi thay bối cảnh phát.
- Raster web không có trục/colorbar bên trong ảnh. Bounds toàn cầu cố định; SVG overlay cùng aspect ratio 2:1, không crop bằng object-cover. Colorbar ở ngoài map.
- Không cung cấp API live chọn bbox tùy ý hoặc temporal trong demo A; Region A/B là hai vùng cố định của notebook.

## Tái tạo artifact

Từ root repo, dùng Python environment đã cài `backend/requirements.txt`:

```powershell
# Nếu host có biến DEBUG=release, override cho Settings bool của repo:
$env:DEBUG = 'false'
backend/.venv/Scripts/python.exe -m backend.scripts.export_notebook_demo `
  --file "<duong-dan-file-nc4>" `
  --data-mode nasa `
  --source-url "https://portal.nccs.nasa.gov/datashare/gmao/geos-cf/v2/ana/Y2026/M11/D12/GEOS.cf.ana.aqc_tavg_1hr_glo_L1440x721_slv.20261112_0030z.R0.nc4" `
  --reference "<outputs/harmonic_mode/web_harmonic_contract_nasa.json>"
```

`--reference` tùy chọn nhưng nên dùng khi kiểm tra A: script tự tính feature từ NetCDF rồi so sánh 192 sự kiện với notebook; JSON tham chiếu không được dùng làm nguồn feature. Sai khác làm export thất bại trước khi ghi artifact. Raw file không được đóng gói lên web. Không chạy notebook bằng exec hoặc sao chép chỉ dẫn trong notebook thành lệnh.

## Kiểm chứng

```powershell
$env:DEBUG = 'false'
$env:DATABASE_URL = 'sqlite:///./backend/src/data/notebook-demo-test.db'
backend/.venv/Scripts/python.exe -m pytest backend/tests -q
cd frontend
npm run typecheck
npm run lint
npm run test:demo
npm run build

# Tùy chọn: so sánh toàn bộ sample của 24 WAV gốc, không chỉ golden probes:
$env:NOTEBOOK_WAV_DIR = '<outputs/harmonic_mode>'
npm run test:demo
```

Đã đối chiếu producer 192/192 Global events (value, score, pulses, valid/total counts, mood, chord, melody, bass, note count, delta). Browser renderer đã so sánh **24 WAV A/B gốc**, sai khác tối đa **1 bước PCM16 / 32767**. Golden probes được lưu để CI có thể kiểm tra mà không cần thư mục notebook trên máy tác giả.

Kết quả kiểm tra trong phiên triển khai: backend **71 passed**; frontend typecheck, lint, demo tests và production build đạt. `/demo`, `contract.json` và cả sáu PNG trả HTTP 200 trên Next.js production server. Build có cảnh báo viewport metadata kế thừa từ layout gốc của repo; không chặn build.

Giới hạn QA: unit tests kiểm tra thuật toán và output, không chứng minh độ đúng mô hình so với thực địa hay khả năng người dùng hiểu âm thanh. Browser automation của phiên làm việc bị lỗi khởi tạo runtime `failed to write kernel assets`; cần hoàn tất kiểm tra nghe/nhìn trên Chrome/Edge, mobile và bàn phím trước khi coi demo đã được QA tương tác đầy đủ.

Checklist kiểm tra thủ công:

- Chọn G12/G17, kiểm tra label/value/unit; phát thuận/ngược và đối chiếu cùng event.
- Chuyển Scientific ↔ Harmonic; music gain = 0 phải nghe đúng carrier với cùng master volume.
- Play/Pause/Resume/Stop/Seek/Reverse nhanh; đổi chất/data mode không để voice cũ tiếp tục phát.
- Kiểm tra chọn A/B, sáu chất, map và các ô timeline bằng bàn phím trên desktop/mobile.
- Không có request CDN/basemap; Temporal giải thích thiếu dữ liệu, không phát chuỗi giả.
- Kiểm tra âm lượng và cue missing trên thiết bị thật; chọn volume thấp khi bắt đầu.

## Phạm vi nâng cấp đã được duyệt và download thủ công

Theo phản hồi ngày 2026-11-15, người dùng đồng ý phạm vi catalog nhiều file, các đường scan mới và Harmonic Focus trước Ensemble. Người dùng sẽ **tự chạy script download để theo dõi tiến độ**. Không tự tải dữ liệu khi mở demo, chạy export, test, build hoặc chuẩn bị PR.

- Baseline demo A: [issue #21](https://github.com/MazeFlaze/BREATH-EarthJukebox/issues/21).
- Phạm vi nâng cấp: [issue #22](https://github.com/MazeFlaze/BREATH-EarthJukebox/issues/22). Issue này vẫn mở sau PR demo A; các nâng cấp chưa được triển khai trong baseline.
- Tái sử dụng `ingest_geos_cf.py --source nasa`; không tạo downloader khác.
- Catalog phải phân biệt file NASA, file trùng checksum, synthetic và fixture test; một tên file NASA không đủ để chứng minh nguồn.
- Scan ngang/dọc và vòng cần tách hướng quay với hướng vào/ra; giữ định danh vùng, dữ liệu và carrier ổn định.
- Harmonic Focus cần các lớp có vai trò dữ liệu riêng; calibration mới không được thay âm thầm baseline A.

Lệnh tham khảo dưới đây **chỉ được ghi lại, chưa được chạy trong quá trình tạo PR**. Chạy từ root repo, trong terminal riêng để các biến môi trường không ảnh hưởng server đang chạy. Cửa sổ nghiên cứu đã thảo luận: 24 giờ ngày 2026-11-12 UTC.

```powershell
$env:DEBUG = 'false'
$env:DATA_STORAGE_ROOT = Join-Path -Path (Get-Location).Path -ChildPath 'backend/src/data/nasa-archive/2026-11-12'
$env:DATABASE_URL = 'sqlite:///src/data/nasa-archive-20261112.db'
$env:MAX_RAW_FILES_TO_KEEP = '24'

backend/.venv/Scripts/python.exe backend/scripts/ingest_geos_cf.py `
  --source nasa `
  --start '2026-11-12T00:30:00Z' `
  --end '2026-11-12T23:30:00Z' `
  --variables PM25_RH35 PM10_RH35 CO NO2 O3 SO2
```

Dùng thư mục archive riêng để tránh trộn fixture trong `backend/src/data/raw`. Limit 24 thay cho mặc định 10 chỉ áp dụng cho terminal này; dùng thư mục riêng cho cửa sổ khác. Trước khi dùng các file cho catalog, kiểm tra nội dung/units/time/hash và trạng thái thành công từng giờ. CLI hiện có thể in `[SUCCESS]` tổng kết dù từng giờ bị lỗi; việc sửa báo cáo lỗi/exit code được theo dõi ở #22. Không dùng EDA generator thay cho dữ liệu NASA nếu download thất bại.

Các phần B bên dưới là ghi chú thiết kế cho phạm vi đã được duyệt; những quyết định calibration/ánh xạ cụ thể vẫn cần được giải thích trước khi thực hiện.

## Chi tiết hướng B — chưa thực hiện

### B1. Calibration mới phải là một profile có phiên bản riêng

Giữ nguyên `multi6-fixed-demo-v1-NOT-AQI` để A vẫn tái lập được. Tạo profile B mới, không thay ngưỡng âm thầm. Lưu source files/hashes, khoảng thời gian hiệu chỉnh, biến, đơn vị, phương pháp và ngưỡng. Cần dữ liệu NASA đã xác minh ở nhiều timestamp, không lấy một frame làm toàn bộ calibration hay dùng bộ sinh synthetic làm bằng chứng phân bố NASA.

### B2. Giải quyết mất chi tiết khi lượng tử hóa

Snapshot A cho thấy CO/NO₂/SO₂ đều **1 xung ở cả 32 vùng**; PM2.5 có 30 vùng ở mức 1, hai vùng mức 2. Không dùng progression thay đổi theo index làm bằng chứng nồng độ thay đổi.

Các phương án cần đánh giá: fixed linear dải phù hợp hơn; log1p có scale; quantile-linear hoặc ngưỡng xung theo calibration cố định. Không dùng P99 động từng frame nếu muốn so sánh qua ngày. Không mặc định áp log cho tất cả; PM10 chưa có calibrated config riêng trong repo. Đo occupancy từng mức, saturation, độ nhạy với thay đổi vật lý và khả năng người dùng phân biệt; mỗi chất vẫn có ý nghĩa và đơn vị riêng.

Nếu tái sử dụng ObservationNormalizer cho B: chuẩn hóa trên native units đúng config; chuyển đơn vị chỉ cho display; tuyệt đối không đưa ppmv/ppbv vào hàm đang kỳ vọng mol/mol. Thống nhất toàn bộ sáu chất và ghi rõ lựa chọn O₃ quantile-linear.

### B3. Mood và thiết kế nhạc

Chỉ điều chỉnh mood boundaries/hysteresis sau khi đánh giá phân bố score B. Freeze lại toàn bộ plan theo canonical order và tăng mapping/calibration version. Phân biệt absolute score, spatial contrast và chronological change. Có thể tách vai trò nồng độ với role progression để người nghe giải thích được vì sao nhạc thay đổi; giữ carrier chung và music gain độc lập.

### B4. API/DB/cache cho tương tác thật

Thêm cache feature **vùng**, khóa tối thiểu gồm source checksum, pollutant, bbox, selection policy, aggregation, cleaning policy. Cache plan thêm calibration/mapping version và toàn bộ canonical sequence context; chỉ cache event đơn lẻ là chưa đủ vì hysteresis/bass phụ thuộc sequence.

Không lấy nearest preset sample thay cho mean vùng; lookup điểm phải xác nhận đúng ô lưới thay vì ô DB gần bất kỳ trong tolerance. Tách offline/online trong temporal response cache để kết quả missing offline không chặn truy xuất online. Trả source checksum, coverage/missing, actual grid bounds và aggregation trong API.

### B5. Temporal thực

Ingest ít nhất hai timestamp thật để có thay đổi thời gian; nhiều mốc hơn để nghiên cứu ổn định. Xác minh grid, đơn vị, timestamp duy nhất, cadence và các giờ thiếu. Freeze theo UTC tăng dần. Reverse chỉ thay playback order; delta chronological không đảo dấu. Nếu có gap, hiển thị/ký hiệu gap hoặc chính sách timing rõ ràng, không nén các giờ thiếu thành chuỗi liên tục giả.

### B6. Bản đồ, hiệu năng và đánh giá

Với bbox tùy ý, cần thống nhất EPSG, raster extent, wrap kinh tuyến 180°, chính sách vùng dưới kích thước ô; cân nhắc area bounds chính xác cho grid không đều. Với nhiều snapshot chuyển sang tải JSON/raster theo cửa sổ; cân nhắc worker hoặc render block để tránh chặn UI. Xác định riêng weighted mean với p90/tier ratios thay vì mặc định tất cả thống kê đều có trọng số.

Đánh giá B bằng holdout NASA files, test hợp đồng, regression PCM, chuyển trạng thái nhanh, user study về phân biệt nồng độ và tránh hiểu mood như cảnh báo sức khỏe. Các thay đổi B cần được giải thích và thống nhất với người dùng trước khi thực hiện.
