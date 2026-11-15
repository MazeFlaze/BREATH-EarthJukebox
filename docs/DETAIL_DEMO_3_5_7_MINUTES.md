# Demo grid chi tiết — Focus và Native Spectral trong 3/5/7 phút

> Đợt sửa mới hợp nhất demo và nhiều timestamp; xem [UNIFIED_DEMO_LOCAL.md](UNIFIED_DEMO_LOCAL.md). Bản mới đã đạt typecheck/lint và 35 test sau khi được cho phép; build/browser QA chưa chạy. Mô tả và kết quả kiểm chứng bên dưới thuộc phiên bản trước.

> Bổ sung mới: `/demo` mặc định dùng phối khí theo cấu trúc dữ liệu; Scientific và Harmonic cũ vẫn có để đối chiếu. Xem [CONTEXT_ORCHESTRATION_LOCAL_DEMO.md](CONTEXT_ORCHESTRATION_LOCAL_DEMO.md) cho mapping mới, giới hạn và cách kiểm tra. Phần mô tả Harmonic dưới đây ghi lại bản legacy.

Người dùng đã chấp thuận phạm vi sau nghiên cứu: một chất tại một snapshot, thời lượng 3/5/7 phút, Focus tổng quan là mặc định, Native Spectral là thử nghiệm và có zoom/solo để nghe chi tiết. Đây là triển khai local để người dùng nghiệm thu; chưa commit/push hoặc thay đổi GitHub. Không chạy downloader NASA.

## Mở demo

Server kiểm tra local: **http://127.0.0.1:3100/demo**. Khi tự chạy từ `frontend`, dùng:

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3100
```

Route `frontend/src/app/demo/` và catalog/cache trong `frontend/public/data/geos-cf-catalog/` đều được ignore. Clone repo mới không có route local. Các module xử lý/audio dùng chung nằm ngoài route. Giao diện mới là tab mặc định; tab **Đối chiếu A/B · 32 vùng / Temporal** giữ bản cũ để so sánh, không đổi waveform golden của A.

## Dữ liệu nguồn và export

Catalog hiện có 1 snapshot độc lập đủ điều kiện: `2026-11-12T00:30:00Z`, SHA256 `8c041bb77c65fe609bea34a2992e8a9c4c3b7efa7419f4b4acd5cde3e9a78198`. Một bản trùng và ba file synthetic/fixture/không đúng lưới bị loại. Có script tải NASA trong repo; việc có script không đồng nghĩa đã có archive nhiều giờ.

Giữ quy trình tải thủ công trong [ISSUE_22_LOCAL_DEMO.md](ISSUE_22_LOCAL_DEMO.md). Sau khi người dùng tự tải thêm file, chạy từ root repo:

```powershell
$env:DEBUG = 'false'
backend/.venv/Scripts/python.exe -m backend.scripts.export_geos_cf_catalog `
  --raw-dir 'backend/src/data/nasa-archive' `
  --raw-dir 'backend/src/data/raw' `
  --raw-dir 'D:/MY LESSON/NASA/demo'
```

Export chỉ đọc local. Ngoài baseline JSON/PNG, mỗi source hash có `detail.json` và sáu file `native-<pollutant>.f32`. Schema Pydantic v2 ghi đủ nguồn, timestamp, shape, thứ tự tọa độ, units, checksum từng artifact, min/max và valid count. Cache chuyển sang đơn vị hiển thị bằng `NotebookDemoProcessor.prepare_fields`, cùng cleaning và dữ liệu của baseline; không dùng sample ở điểm preset DB thay cho dữ liệu vùng.

Binary Float32 little-endian có 721 × 1440 mẫu, hàng từ Bắc xuống Nam, cột từ Tây sang Đông. IEEE NaN giữ missing riêng với valid zero. Đây là cache chuyển đơn vị có độ chính xác Float32; hash artifact khác hash file NetCDF nguồn và được ghi riêng. Browser đối chiếu source hash/timestamp với catalog, shape, checksum và valid count trước khi dùng. Không có NASA request khi mở trang.

## Ba mức chi tiết độc lập

1. **Grid:** 32/128/512/2.592/64.800 vùng hoặc mẫu gốc 0,25°. Mỗi grid lấy mean có trọng số cos(vĩ độ) từ các mẫu nguồn thực sự thuộc vùng; mọi mẫu trong ROI được xét đúng một lần. Grid gốc có 1.038.240 mẫu, không phải từng đó trạm quan trắc.
2. **Voice:** Focus tổng hợp thành tối đa 8 hoặc 16 dải theo chiều vuông góc thanh quét. Mean/P90/IQR của dải tính trực tiếp từ mẫu gốc, không lấy lại mean/P90 của các mean trên màn hình. Native Spectral dùng mỗi hàng/cột của grid đang chọn làm một thành phần phổ. Chỉ khi chọn mức **Mẫu gốc** mới có mỗi hàng/cột nguồn đóng góp riêng.
3. **Thời lượng:** 180/300/420 giây cho một chất và một snapshot hoặc ROI. Với grid gốc, quét ngang 1.440 cột tương ứng 125/208,33/291,67 ms mỗi cột; quét dọc 721 hàng tương ứng 249,65/416,09/582,52 ms mỗi hàng. Đổi thời lượng không đổi pitch như tăng playbackRate.

Toàn bộ dữ liệu được xét không đồng nghĩa tai nghe phân biệt được mọi mẫu riêng. Focus công bố rõ footprint của dải nghe. Native có thể dày phổ; zoom/solo giúp nghe lại. Playlist áp dụng thời lượng riêng cho từng snapshot, chỉ đi tới các timestamp được chọn ở phía sau, không tự vòng lại hoặc nội suy giờ thiếu. Nghe sáu chất lần lượt ở mức 5 phút/chất là 30 phút cho một snapshot.

## Mapping liên tục, giữ calibration A để đối chiếu

Mapping mới: `detail-continuous-log99-v1`. Dữ liệu, units và audio_max A vẫn giữ nguyên. Lens cố định `log(1 + 99 × clip(value / audio_max, 0, 1)) / log(100)` điều khiển biên độ. Không có P99 hoặc normalization tự thay theo mỗi frame. Giá trị đọc trên bản đồ không bị chặn; âm thanh bão hòa trên max A vẫn là giới hạn được công bố. Chưa tạo calibration khoa học mới từ một timestamp.

- **Scientific liên tục:** carrier liên tục có biên độ từ mean/giá trị mẫu; register biểu diễn vị trí địa lý. Đây không phải chuỗi 1–5 xung của A hay B 32 vùng.
- **Focus Harmonic:** Accent theo P90; Pad theo IQR không trọng số; Bass và Texture theo tương phản với lát cắt láng giềng cố định. Gain/mute/solo stem chỉ tác động nhạc, không đổi data bus. Các lớp không tạo progression ngẫu nhiên để giả làm biến thiên dữ liệu.
- **Native Spectral:** chỉ một ngân hàng sine, không thêm bốn stem cho từng mẫu. Dải register log khoảng 120–6.000 Hz (cap 0,4 × sample rate nếu thiết bị có sample rate thấp). Vị trí Bắc cao khi quét ngang; Đông cao khi quét dọc, kèm pan theo kinh độ. Đây là chế độ nghe cấu trúc phổ, không cam kết đọc riêng được hàng trăm/một nghìn voice.
- **Zoom:** register lấy tọa độ địa lý, không kéo giãn lại theo ROI. Vùng nhỏ có thể có các register gần nhau hơn; đó là lựa chọn giữ ổn định vị trí, không phải một calibration nồng độ khác.
- **Missing:** giá trị NaN không phát carrier; cue 165 Hz ngắn dùng tỷ lệ thiếu của các voice đang chọn. Valid zero không bị thay bằng missing cue. Một mẫu riêng có IQR nội bộ bằng 0; không diễn giải điều này thành môi trường đồng nhất.
- **Chuyển tiếp:** biên độ được làm mượt với hằng số thời gian 8 ms, nên âm thanh có một phần chuyển tiếp từ lát cắt trước. Target feature của mỗi lát cắt không đổi theo reverse; waveform tại ranh giới có thể khác do smoothing/phase liên tục, không tuyên bố PCM reverse giống từng block A.

Gain ngân hàng cố định theo số voice người dùng chọn, volume và Monitor gain; không normalize theo dữ liệu frame. Thay vùng voice có thể thay loudness. Output guard chỉ tác động trên 0,88, giới hạn ở 0,90; counter hiện trên UI. Nếu counter tăng, giảm Monitor gain để hạn chế biến dạng. Không dùng guard làm bằng chứng đã nghe đủ chi tiết.

## Tương tác và vòng đời

- Mặc định Focus, mẫu gốc, ngang, 8 dải, 5 phút. Audio chỉ khởi tạo khi Play/Nghe thử.
- **Nghe thử 20 giây** dùng cùng tốc độ dự kiến của lượt đầy đủ, không nén cả lượt thành 20 giây. Giới hạn preview chạy theo sample clock; seek trong preview bắt đầu lại cửa sổ 20 giây tại vị trí mới. Preview không tự chuyển snapshot.
- Click bản đồ chọn ô và seek tới lát cắt chứa ô. Mean của ô đang xem khác mean của dải đang phát; UI ghi riêng hai giá trị. Source-qualified ID và bounds hiện trong provenance.
- Zoom vùng bằng hai góc; hoặc focus canvas rồi dùng mũi tên di chuyển và Enter/Space xác nhận góc. Zoom mẫu gốc ở tâm ô chọn đúng một mẫu nguồn. Không hỗ trợ ROI băng qua kinh tuyến 180°; chọn vùng có west ≤ east.
- Voice range và Solo dải chứa ô áp dụng cả data bus và nhạc. Footprint đang góp âm thanh được tô trên map và ghi bằng bounds. Ở Focus, solo là solo dải, không giả vờ là solo một điểm bên trong dải.
- Pause/resume giữ cursor. Stop và đổi lựa chọn hủy generation cũ; worker bị terminate khi đổi yêu cầu. Processor nhận dispose, bỏ dữ liệu và trả false để không giữ các ngân hàng cũ hoạt động. Đổi tab đối chiếu đóng context của demo hiện tại.

## Kiến trúc và kiểm chứng

Web Worker tổng hợp grid, coverage và quantile; Canvas hiển thị raster, không tạo một triệu DOM node. AudioWorklet phát theo block bằng oscillator recurrence, không render trước PCM nhiều phút cho từng voice. Mỗi lần chỉ giữ trường của chất/snapshot đang chọn và view đang dùng; cấu trúc bộ nhớ không tăng theo thời lượng audio.

Kiểm tra đã thực hiện trên bản local:

- Backend pytest: schema nguồn, cache checksum, north-first layout, missing/zero, tái dùng và sửa cache hỏng; cùng toàn bộ regression baseline.
- Frontend: đủ mẫu ở mọi cấp grid, mean/quantile từ raw, ROI/register, clocks 3/5/7, missing/zero, DSP deterministic, headroom, 1.440 voice, cap tần số, dispose/preview và baseline golden PCM.
- Cache NASA thật: mean 32 vùng của cả sáu chất khớp baseline trong sai số Float32 đã kiểm tra; mỗi trường xét đủ 1.038.240 mẫu của snapshot hiện có.
- Typecheck/lint/build và HTTP assets. Warning viewport metadata có sẵn ở root layout vẫn còn.
- Edge headless với profile kiểm thử riêng: load/checksum/worker, Focus Play/Pause/Resume, Native Spectral 721 voice ngang và 1.440 voice dọc đã chạy, không có exception ứng dụng trong lượt thử ngắn; output guard counter bằng 0 trong các đoạn đã kiểm tra. Đây chưa thay cho nghe trên tai nghe/loa thật hoặc đo đầy đủ dropout trên mọi thiết bị.
- Kết quả cuối: **89 test backend, 25 test frontend**, typecheck/lint/build đạt. Kiểm tra trình duyệt qua đủ sáu chất và sáu mức grid, chuyển hướng sau seek ở cột cuối, ROI 2×2 bằng phím, zoom một mẫu, đổi thời lượng, chuyển tab A/B rồi quay lại. Layout 390 px và 1440 px không tràn ngang; screenshot đã được xem để kiểm tra bố cục.
- Preview Harmonic thực tế dừng tại `0:20 / 5:00`, source step 96 khi quét ngang native, peak khoảng 0,160 và guard counter 0 trong đoạn này. Không suy rộng kết quả đoạn ngắn thành đảm bảo chất lượng nghe ở mọi vùng hoặc thiết bị.

Cần người dùng đánh giá mức rõ/dày phổ, khả năng tìm vùng có nồng độ cao, vai trò từng stem, mức âm, thao tác mobile/keyboard và so sánh ba thời lượng trên cùng khu vực. Chưa có archive NASA nhiều giờ để nghiệm thu playlist thời gian thật. Chưa chọn calibration B/Ensemble hoặc kết luận 5 phút là thời lượng tối ưu.
