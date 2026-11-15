# Demo hợp nhất: dữ liệu động, không gian, thời gian và phối khí

Theo phạm vi người dùng duyệt: sửa demo local, giữ `/demo` ngoài Git; không chạy download hoặc commit/push. Sau khi giải thích tác động, người dùng cho phép bước đầu gồm typecheck, lint không tự sửa và tests. Kết quả mới: **typecheck đạt, lint không có warning/error, 35/35 test đạt, không skip**. Chưa chạy production build hoặc browser QA cho phiên bản hợp nhất, nên **chưa phải nghiệm thu runtime đầy đủ**. Kết quả build/Edge ở checkpoint trước không áp dụng cho giao diện mới.

## Luồng sử dụng mới

Mở `/demo` ở frontend dev server đang dùng. Một màn hình có chung chất, phạm vi (toàn bản đồ / ROI / A-B), khoảng UTC, độ chi tiết, dải nghe và cách nghe. Không có tab Journey hay Harmonic legacy riêng. Mặc định diễn biến thời gian, toàn bản đồ, native, 8 dải và 5 phút cho cả khoảng. Nếu chỉ có một timestamp, bản đồ/đặc trưng giữ nguyên; không tạo diễn biến giả.

Ba cách duyệt trong cùng màn hình:

- **Diễn biến theo timestamp:** mỗi giờ là một bước của audio clock; Mean/P90/IQR tính trực tiếp trên toàn bộ native samples trong mỗi dải của toàn bản đồ hoặc ROI. 24 giờ trong 300 giây cho mỗi giờ 12,5 giây trình diễn. Không còn chạy quét cột/hàng bên trong bước này. Trục chia dải vẫn chọn được theo vĩ/kinh độ.
- **Quét không gian:** một snapshot, 3/5/7 phút, thanh quét qua cột/hàng. Cách duyệt được người dùng xác nhận ở phiên trước vẫn dùng lại.
- **Quét lần lượt từng timestamp:** hành vi Journey tích hợp, 3/5/7 phút cho cả khoảng, mỗi giờ nhận cùng thời lượng. Quét nhanh làm giảm chi tiết nghe so với 3–7 phút mỗi snapshot; UI ghi rõ. Không tính đạo hàm không gian xuyên ranh giới snapshot.

Play/Pause/Resume/Stop, preview 20 giây theo clock hiện tại, thanh UTC, seek, bước trước/sau và reverse dùng chung. Stop về đầu theo hướng phát. Đổi dữ liệu hoặc cách tổng hợp sẽ dừng audio và tạo phiên mới; chất/khoảng UTC/cấu hình phối khí được giữ khi đổi phạm vi. Đổi duration hoặc reverse dừng lượt hiện tại nhưng không tải lại toàn bộ chuỗi dữ liệu.

ROI dùng bbox Nam/Tây đóng, Bắc/Đông mở (trừ Bắc=90°) theo chính sách notebook; bbox không chứa tâm mẫu sẽ lấy tâm gần nhất và canvas thể hiện footprint thực. Chọn ROI bằng hai góc hoặc nhập tọa độ rồi Áp dụng. Nút nghe mẫu ở tâm ô chọn một native cell. A/B có bbox mặc định từ notebook; so sánh dùng cùng calibration. Khi quét hai ROI khác chiều dài, các lát được giữ theo tiến độ chuẩn hóa, không nội suy giá trị; các đạo hàm vẫn lấy từ khoảng cách gốc của từng ROI. Pan A/B của phối khí tách trái/phải để nhận diện, không phải đo vị trí nguồn âm thật.

## Phục vụ artifact dành riêng cho demo

Lỗi đã chẩn đoán trước khi sửa: catalog có 24 ready, mọi manifest và native file có trên đĩa, nhưng production server 3100/3101 chỉ nhận URL cũ; dev server 3000 nhận URL mới. Next.js production lập danh sách public assets lúc khởi tạo.

Route local `frontend/src/app/demo/assets/[...path]/route.ts` đọc trực tiếp artifact mỗi request, Node runtime, force-dynamic/no-store. Chỉ cho phép index, manifest/snapshot, PNG và sáu native f32 trong catalog. Kiểm tra hash path, tên file, realpath; không phục vụ raw, `.env`, path traversal hoặc symlink thoát thư mục. GET/HEAD có MIME và Content-Length. File thiếu trả JSON lỗi rõ ràng, không trả dữ liệu khác thay thế.

`demoAsset` ánh xạ `/data/geos-cf-catalog/...` trong artifact cũ sang `/demo/assets/...`; không đổi schema, source SHA hoặc nội dung export. Shared `loadDetail` nhận URL resolver tùy chọn, giữ default cho các caller cũ. Canvas dựng từ native data nên không phụ thuộc PNG tĩnh khi chuyển giờ.

Server cần nạp **mã route mới một lần**. Dev server có thể hot reload; production server cần được build/start lại khi được cho phép. Sau đó exporter sinh snapshot mới trong cùng catalog root và nút **Cập nhật dữ liệu** đọc index mới, không cần build lại chỉ để nhận file mới. Không đổi downloader hoặc chuyển nghiệp vụ sang FastAPI. Không mở API share/upload.

## Đồng bộ và buffer

Session gồm feature arrays theo canonical source order, slots có timestamp/source hash hoặc gap, cùng một AudioWorklet clock. Canvas và readout chọn slot từ tick của worklet. Native views cache tối đa 3 snapshot; raw values không được giữ cho cả archive. Khi chuẩn bị chuỗi cần đọc tất cả timestamp để tạo feature plan, tiến độ là số snapshot đã hoàn thành thật.

Một horizon giới hạn sample clock tới cuối slot đã sẵn sàng. Khi đến ranh giới timestamp, UI lấy đúng view (ưu tiên prefetch) và mở horizon tiếp theo sau khi view đã được commit. Nếu chưa sẵn sàng, đồng hồ không tiến và audio block im lặng; đây là buffer có thông báo, **không cam kết gapless**. Preview kết thúc theo 20 giây audio clock, không tính thời gian chờ. Nếu asset lỗi, tạm dừng và báo lỗi; không tiếp tục chạy âm dưới ảnh cũ.

Giờ thiếu bên trong khoảng được giữ thành slot: mean/P90 NaN, coverage=0, không source hash, không raster của giờ khác; cue thiếu vẫn hoạt động. Reverse đảo source step, không tính lại feature hoặc đổi dấu chronology. Không nội suy trường nồng độ, không suy ra gió/particle motion từ sáu biến nồng độ. Thang màu cố định giữa các timestamp.

## Phối khí mọi cách xem

Engine additive/context và Scientific liên tục hiện có được dùng lại. Harmonic cũ và Native Spectral giữ trong mã đối chiếu, không xuất hiện trong luồng người dùng mới. Scientific ở đây là carrier log99 theo vị trí, không được gọi là pulse carrier notebook A.

- Mean → nền mềm; P90−Mean → tối đa 3 điểm nhấn; IQR → âm ngân trầm; gradient/curvature → tối đa 2 biên. Các dải còn lại vẫn góp nền/IQR.
- Spatial mapping giữ `context-spatial-pentatonic-v1`, với đạo hàm theo độ góc.
- Temporal mapping riêng `context-temporal-hourly-pentatonic-v1`: đạo hàm theo giờ UTC, dùng cùng mức tham chiếu nghệ thuật số 0,02/0,01 theo đơn vị giờ/giờ². Đây là lựa chọn R&D mới, không phải calibration khoa học hoặc mức sức khỏe. Không tính xuyên gap. IQR vẫn là phân tán không gian mỗi dải, không đổi thành uncertainty hoặc IQR thời gian.
- Một native sample có P90=mean và IQR=0: không tạo giả hai lớp đó; biến thiên giữa giờ vẫn có thể điều khiển biên.
- Volume/monitor/reference/space và gain/mute/solo bốn lớp dùng chung. Solo nhạc cần reference=0; missing cue vẫn giữ riêng. Lọc/smoothing/đuôi âm có thể kéo ngắn qua ranh giới dữ liệu.
- JSON trace ghi options, calibration/mapping, direction/duration, source của từng slot, step hiện tại, cửa sổ/điểm nhấn và controls. Giá trị gốc không sửa; âm vẫn saturation ở audio_max A.

## File thay đổi

- Local-only `app/demo/page.tsx`: một entry duy nhất.
- Local-only `app/demo/UnifiedDemo.tsx`: điều khiển/session/map/readout/mixer/truy vết chung.
- Local-only `app/demo/session.ts`: resolver, catalog refresh, bounded view cache, ROI, ghép dải A/B, timeline/gaps/horizon.
- Local-only `app/demo/assets/[...path]/route.ts`: phục vụ artifact động.
- Local-only `app/demo/DetailDemo.tsx`: xuất lại component map để tái sử dụng; bản demo cũ giữ làm đối chiếu.
- Local-only `app/demo/demo.module.css`: layout chung, UTC strip, A/B, buffer và reduced motion.
- `services/geosCfDetail.ts`: resolver tùy chọn, no-store.
- `services/geosCfStreamAudio.ts`: truyền horizon đến worklet.
- `types/geosCfDetail.ts`: temporal summary, domain/coordinates, precomputed spatial derivatives và buffering tick.
- `public/audio/geos-cf-data.mjs`: summary theo toàn ROI/dải trực tiếp từ native samples.
- `public/audio/geos-cf-orchestration.mjs`: temporal derivative version, window boundaries, spatial derivatives theo từng ROI và pan A/B.
- `public/audio/geos-cf-stream.worklet.mjs`: chặn clock tại horizon, không nhầm buffering với done.
- `scripts/unified-demo.test.cjs`: 5 regression cases mới đã chạy đạt cùng 30 test demo hiện có; chưa thêm vào lệnh test mặc định.
- Tài liệu này và link từ hướng dẫn detail/context cũ.

Không đổi backend/preprocessing/calibration NASA, package/lockfile, raw/cache catalog hoặc route chính. Bản sao UI trước sửa: `.local-backups/demo-before-unification-bee90b93e9364fbaa0a3e3184a1cbc49.zip`; shared modules có thể đối chiếu HEAD checkpoint. Không commit/push thay đổi này.

## Kiểm tra đã chạy và kiểm tra thủ công còn lại

Đã chạy theo phép của người dùng ngày 2026-11-15:

```text
npm.cmd run typecheck                   exit 0
npm.cmd run lint                        exit 0, no warnings/errors
node --test scripts/notebook-demo.test.cjs scripts/catalog-demo.test.cjs scripts/detail-demo.test.cjs scripts/context-demo.test.cjs scripts/unified-demo.test.cjs
                                       35 pass, 0 fail, 0 skip
npm.cmd run build                       exit 0
```

Các test mới xác nhận summary/quantile từ native samples, temporal derivatives/gap, cửa sổ không vượt snapshot, ghép A/B, reverse horizon, buffer không làm clock tiến/done sớm, và artifact route đọc file mới/no-store/từ chối traversal. Không phát hiện lỗi trong các bước này nên chưa cần sửa thêm source.

### Nghiệm thu production trên trình duyệt, 2026-11-15

Server kiểm thử riêng `http://127.0.0.1:3102/demo`, Edge headless/profile riêng qua CDP; công cụ browser tích hợp không khởi tạo được. Không tác động phiên dev đang chạy của người dùng. Đã quan sát ảnh desktop 1440px và mobile 390px; không tràn ngang trang.

- HTTP: index 200/no-store; đủ 24 manifest thật đối chiếu source SHA và 48 HEAD native CO/PM2.5. File giả lập không nằm trong index, có `isMock: true`, được tạo sau khi server đã start: từ 404 thành 200, sau đó xóa đúng fixture. Index không thay đổi; không tải NASA hoặc sửa dữ liệu thật. `/`, `/landing`, `/demo` đều 200. Tên artifact ngoài allowlist trả 400, manifest không tồn tại trả 404.
- Preview kết thúc đúng 20 giây audio clock; Pause giữ cursor, Resume tiếp tục. Raster đổi khi sang 01:30 UTC; JSON trace có đủ 24 source và SHA đúng timestamp đang xem.
- Trì hoãn request native thật của timestamp xa rồi seek tới đó: buffering giữ nguyên clock, UI báo chờ, release request thì tiếp tục với đúng UTC. Seek trong cùng giờ rồi Resume cũng hoạt động.
- Phát trọn phiên 3 phút qua đủ 24 timestamp, kết thúc đúng cursor 180 giây, output guard = 0. Phát ngược bắt đầu từ timestamp cuối.
- Toàn bản đồ/ROI/A–B đều dựng map và phát; chuyển Scientific/phối khí trên cùng phiên. Ba cách duyệt hoạt động; native quét dọc 16 dải có 721 bước/snapshot và 24 × 721 bước cho chuỗi. Kế hoạch 7 phút khởi phát được; sáu chất đều khởi phát được với output guard = 0.
- Chọn ROI bằng Enter/phím mũi tên trên canvas; nghe một native sample cho raster 1 × 1; A/B bố trí được ở 390px. Cập nhật catalog vẫn nhận 24 snapshot. Một AudioContext được tái sử dụng; không có runtime exception hoặc network loading failure trong phiên kiểm tra.

Bằng chứng local-only: `.local-backups/unified-qa/report.json`, `run.log`, `desktop.png`, `mobile.png` và JSON trace. Không commit/push. Build còn warning viewport metadata kế thừa từ layout hiện có; build không thất bại.

Giới hạn nghiệm thu: phát đầy đủ chỉ thực hiện với phiên 3 phút PM2.5; preview dùng kế hoạch 5 phút, các chất khác và kế hoạch 7 phút mới kiểm tra khởi phát. Chưa thử toàn bộ tổ hợp coarse/native, stem/mute/solo, touch thật, screen reader, corrupt/missing HTTP hoặc catalog có giờ thiếu trên browser; gap/quantile/horizon đã có regression test. Headless audio chứng minh hoạt động engine và guard, không thay thế đánh giá độ êm/dễ nghe bằng tai của người dùng.

Checklist để người dùng kiểm tra tiếp hoặc lặp lại:

1. Nạp phiên dev server có route mới; mở `/demo/assets/index.json` và detail URL của một snapshot mới. Cả hai cần 200/no-store. Export thêm snapshot khi server vẫn chạy rồi cập nhật catalog, kiểm tra không 404. Không tự chạy downloader trong QA.
2. Toàn bản đồ, PM2.5, native, khoảng 24 giờ, 5 phút: chờ tiến độ hoàn tất, Play, xác nhận UTC/raster/readout/source cùng đổi mỗi 12,5 giây audio clock. Pause giữ clock, Resume tiếp tục, Stop về đầu.
3. Preview kết thúc sau 20 giây audio clock. Seek trong cùng giờ rồi sang giờ khác, reverse và thay duration. Nếu tải chậm, clock phải dừng ở ranh giới và báo buffer; không gắn timestamp mới lên raster cũ.
4. Chuyển ROI và A/B, giữ chất/khoảng UTC/phối khí; kiểm tra sáu chất, hai hướng, hai mức dải, coarse/native, bbox nhỏ tới một điểm. Ở A/B có hai canvas cùng timestamp, cùng scale.
5. Thử ba cách duyệt trong cùng màn hình; xác nhận không còn tab Journey/Harmonic legacy. So sánh Scientific/context, từng stem và reference mix; nghe đánh giá chất lượng, không suy ra chỉ số nguy hại.
6. Với catalog thử nghiệm được gắn nhãn khi được cho phép: thiếu giờ giữa hai snapshot phải có slot/cue riêng, không suy ra gradient xuyên gap. Thử response missing/corrupt/aborted và đổi lựa chọn nhanh.
7. Tab/Enter/Space trên canvas; nhập bbox và seek bằng bàn phím; kiểm tra 390px/1440px, reduced motion. Không tuyên bố đã đạt mobile/keyboard chỉ từ CSS.
8. Typecheck/lint, 35 test, production build và browser QA đã đạt trong phạm vi ghi trên. Nghe bằng loa/tai nghe để đánh giá chất lượng và thử các tổ hợp chưa được nghiệm thu.
