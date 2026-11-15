# Phương án B — thanh quét và các voice đồng thời

Người dùng đã chọn phương án B sau phần nghiên cứu về quét theo trục. Đây là mapping phát không gian `spatial-sweep-polyphonic-v1`, **không phải calibration nồng độ B mới**. Chỉ triển khai local, chưa commit/push; không chạy download NASA. Route `/demo` tiếp tục được ignore.

## Hành vi

Giữ nguyên 32 vùng 45° × 45°, cùng raw preprocessing, mean vùng có trọng số cos(vĩ độ), source hash, timestamp, đơn vị, score và số xung A. Không giảm grid hay nội suy dữ liệu trong bước này.

| Quét | Thanh hiển thị | Các ô phát cùng lúc | Số lát cắt | Thời lượng toàn snapshot |
| --- | --- | --- | ---: | ---: |
| Ngang | Thanh đứng tiến từ cột Tây sang cột Đông | 4 ô thuộc 4 hàng | 8 | 7,2 giây |
| Dọc | Thanh ngang tiến từ hàng Bắc xuống hàng Nam | 8 ô thuộc 8 cột | 4 | 3,6 giây |

Mỗi lát cắt giữ thời lượng bar gốc 0,9 giây. Mọi voice bắt đầu đồng thời trên cùng audio clock; không nén bốn/tám chuỗi xung thành các khe thời gian nhỏ. Thanh và highlight đi theo các lát cắt rời rạc, không vẽ đường nối tâm zíc zắc hay mô phỏng các giá trị ở giữa.

Global Scan và Archive Journey dùng cách này cho hai hướng ngang/dọc. Rings, Region và Temporal vẫn có hành vi riêng trước đó. Journey nạp từng snapshot rồi quét các lát cắt; một bước không phải một giờ. Các gap thời gian vẫn được liệt kê trong catalog.

## Mapping voice và dữ liệu

- Quét ngang: voice cố định theo hàng, MIDI `[84, 76, 67, 57]` từ Bắc xuống Nam; carrier tương ứng khoảng `[1046,5; 659,3; 392,0; 220,0] Hz`.
- Quét dọc: voice cố định theo cột, MIDI `[48, 52, 55, 59, 62, 65, 69, 74]` từ Tây sang Đông. Stereo pan theo kinh độ giúp phân biệt vị trí trái/phải. Register càng cao khi đi về phía Đông.
- Carrier giữ nguyên số xung, offsets và envelope A; **tần số, pan và gain mix thay đổi theo mapping không gian riêng**. Không tuyên bố waveform B giống carrier 440 Hz của A. Missing dùng offsets/envelope missing A với tần số cao hơn carrier voice một bán âm; valid zero không có carrier.
- Harmonic giữ vai trò Focus: lead theo lens nồng độ cố định, pad brightness theo IQR, bass/texture theo tương phản. Lead chỉ lệch thêm 0–2 bán âm trên register vị trí; các register cơ sở cách nhau ít nhất 3 bán âm. Pad dùng một nốt/voice để giảm mật độ khi nhiều ô cùng phát. Các feature và nguồn số liệu không bị chỉnh để tạo hòa âm.
- Mỗi vị trí có cùng identity khi reverse/seek hay đổi snapshot. Reverse chỉ đảo thứ tự lát cắt, không đảo voice trong lát cắt hoặc freeze lại mood theo đường mới.
- Có gain, mute và solo cho từng voice vị trí; các nút này áp dụng cả carrier và nhạc của voice. Gain/mute/solo stem vẫn chỉ áp dụng phần nhạc. Scientific tắt music bus, giữ các carrier vị trí.
- Mix gain cố định 0,25 cho từng track ở cả hai hướng, không normalize theo mỗi cột/hàng hay số voice đang bật. Solo không tự tăng âm lượng. Bound headroom tính tổng trị tuyệt đối các track ở gain tối đa; nếu không dưới 0,93 thì từ chối phát. Vì quét dọc có nhiều voice hơn, tổng loudness có thể khác quét ngang.

Đây là mã hóa vị trí và nồng độ để khám phá dữ liệu, không phải tổng nồng độ của cả cột/hàng hay một chỉ số sức khỏe. Cần nghe thử để đánh giá các voice có phân biệt được khi bật đồng thời hay đang che nhau.

## Kiểm tra local

1. Mở `/demo`; Global Scan mặc định chọn `B · các ô cùng lát cắt phát đồng thời`.
2. Chọn Ngang và Play: thanh đứng tiến qua tám cột; bảng dưới hiển thị bốn ô của cột đang phát, có giá trị/xung riêng. Không có giá trị trung bình chung cho cột.
3. Solo từng hàng để nhận biết register, rồi bật lại tất cả. Thử Scientific/Harmonic và từng stem. Mute voice phải tắt cả xung lẫn nhạc của đúng vị trí đó.
4. Chọn Dọc: thanh ngang qua bốn hàng, bảng có tám voice theo cột; thử tai nghe để nghe pan.
5. Chọn một ô trên map/grid để xem dữ liệu và seek tới lát cắt chứa ô. Nút bước trước/sau đi theo lát cắt. Reverse, pause/resume và Stop phải giữ đồng bộ audio/map.
6. Để nghe lại A, chọn `Đối chiếu · từng ô zíc zắc`, rồi `A · Notebook baseline` trong Harmonic profile. Baseline vẫn được kiểm tra bằng PCM golden probes.

Chưa có kết luận về chất lượng nghe trên thiết bị thật, keyboard/mobile hoặc khả năng phân biệt tám voice. Các kiểm tra tự động xác nhận grouping đầy đủ/duy nhất, clock đồng thời, dữ liệu bất biến, headroom, reverse/seek PCM, missing/zero, mute/solo routing và hủy lượt phát cũ. Chỉ một timestamp NASA thật hiện có, nên nghe Journey nhiều giờ vẫn chờ archive do người dùng tải thủ công.

Mã hỗ trợ nằm trong `frontend/src/services/geosCfSweep.ts` và audio controller dùng chung; UI nằm ở route local được ignore. Nếu thử nghiệm nghe không đạt, chỉnh mapping vị trí như một version mới; không thay âm thầm calibration A. Sau khi nghiệm thu cách quét này mới cân nhắc tăng grid lên 128 vùng hoặc chọn khu vực để nghe mẫu gốc.
