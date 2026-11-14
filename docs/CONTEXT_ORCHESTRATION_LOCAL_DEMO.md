# Demo local: phối khí theo cấu trúc dữ liệu

Phạm vi: bản thử để người dùng nghe, không stage/commit/push, không chạy downloader NASA. `/demo` tiếp tục nằm trong `.gitignore`. Dùng native cache, checksum và preprocessing hiện có; không đổi API backend, dữ liệu, đơn vị hay calibration A.

## Kiểm tra bản mới

- Mở `/demo`; mặc định **Phối khí theo dữ liệu · mới**, Focus, 8 dải, 5 phút, grid mẫu gốc. Server kiểm thử dùng `http://127.0.0.1:3101/demo` để tách phiên cũ trên cổng 3100. Server dev thông thường vẫn có thể mở `/demo` sau khi cập nhật code.
- Bấm **Nghe thử 20 giây**: 20 giây theo tốc độ lượt đầy đủ, không nén toàn bộ lượt vào 20 giây. Seek hoặc **Từ đầu** để đối chiếu cùng vùng.
- Dùng Mute/Solo/gain từng lớp. Tín hiệu đối chiếu mặc định 0%; giữ 0% khi solo nhạc. **Nghe riêng tín hiệu đối chiếu** tắt target nhạc; smoothing và đuôi âm cần thời gian ngắn để tắt.
- So sánh Scientific, Harmonic cũ và bản phối mới. Các chế độ chưa được cân bằng loudness cảm nhận; chỉnh âm lượng khi so sánh. Chưa khẳng định bản mới dễ chịu trên mọi thiết bị.
- Mở **Truy vết phối khí** dưới bản đồ và tải JSON của cửa sổ đang xem: source SHA256, timestamp, chất, unit, audio_max, ROI, bins, voice range, controls, đặc trưng và nốt được chọn.

## Mapping `context-spatial-pentatonic-v1`

Pipeline: native samples → Focus features → cửa sổ đặc trưng → chọn sự kiện → tổng hợp cộng họa âm → lọc/không gian ngắn → guard. Không dùng API tạo nhạc, sample tải ngoài, progression ngẫu nhiên hay nhạc nền độc lập.

| Lớp | Đặc trưng | Cách phát |
| --- | --- | --- |
| Nền mềm | Mean có trọng số cos(vĩ độ) từng dải/lát | Biên độ `sqrt(clip(mean/audio_max))`; register theo vị trí toàn cầu, C pentatonic C3–C4; mọi dải được chọn góp nền |
| Phím gảy | Cực đại `clip((P90−mean)/audio_max)` trong cửa sổ | Tối đa 3 dải có excess > 0,002; ưu tiên excess lớn; cao độ từ căn score P90 cực đại, C3–C5; attack 15 ms, decay 650 ms |
| Âm ngân trầm | IQR/audio_max không trọng số từng dải/lát | Căn score điều khiển biên độ; register thấp hơn nền một octave; không dùng white noise |
| Chuyển tiếp | 70% score độ dốc + 30% score độ cong | Tối đa 2 dải có edge > 0,025; tiếng gảy thấp, decay 300 ms |

Các ngưỡng là lựa chọn âm nhạc, không phải ngưỡng sức khỏe hoặc hiệu chuẩn NASA. C3=130,81 Hz và C5=523,25 Hz là tần số cơ bản; tổng hợp có thêm họa âm. Tên phím/gảy/ngân mô tả âm sắc tổng hợp, không phải bản thu đàn thật. Không gán nhạc cụ theo quốc gia hoặc suy đoán nguyên nhân phát thải.

Mean/IQR cập nhật từng lát với smoothing 80 ms. Cửa sổ sự kiện gồm `max(1, floor(0.8 × steps/duration))` lát liên tiếp trong source order; mọi lát thuộc đúng một cửa sổ. Ở grid thô, một lát có thể dài hơn 0,8 giây: nền tiếp tục ngân nhưng không tự tạo lại điểm nhấn để lấp thời gian. Cửa sổ cuối có thể ngắn hơn. Khi reverse, feature và danh sách sự kiện cùng source window không đổi; thứ tự nghe và envelope được đảo theo đường quét, không hứa PCM reverse từng mẫu.

P90 cực đại và excess cực đại có thể thuộc hai lát khác nhau. Đây là thống kê cửa sổ, không phải một quan sát gốc duy nhất. Nốt bắt đầu theo cửa sổ nên không định vị chính xác từng native cell. P90 là phân vị trong dải, không phải detector điểm nguồn. Với một mẫu duy nhất, P90=mean và IQR=0: chỉ còn nền, không bịa thêm sự kiện.

### Độ dốc và độ cong

Khoảng cách lấy từ tâm lát theo kinh/vĩ độ, không phải km. Độ dốc là sai phân hai phía, hoặc một phía khi chỉ có một láng giềng hợp lệ. Độ cong là chênh độ dốc một phía chia khoảng cách trung bình, chỉ tính khi cả hai láng giềng hợp lệ. Không nội suy qua lát thiếu. Score chặn 0–1 dùng mức tham chiếu nghệ thuật cố định: 0,02 × audio_max/độ và 0,01 × audio_max/độ². Trường tăng đều có độ dốc nhưng độ cong gần 0. `contrast` legacy giữ nguyên để đối chiếu.

### Trộn âm và giới hạn diễn giải

- Tín hiệu cao cũ mặc định tắt trong bản phối mới. Tham chiếu dùng cùng công thức tần số địa lý và biên độ log99, nhưng pan/smoothing khác Scientific; không khẳng định bằng PCM baseline. Scientific và Harmonic legacy vẫn đi qua DSP cũ; Native Spectral không áp dụng phối khí mới.
- Các bè dùng C pentatonic; không có hợp âm gắn nhãn sạch/bẩn. Cao độ lượng tử hóa, saturation, tổng hợp theo dải và chọn top-3/top-2 đều làm mất chi tiết có công bố. Các dải không được chọn làm điểm nhấn vẫn góp vào nền Mean/IQR. Solo/range chọn lại sự kiện trong phạm vi voice đó. JSON lưu controls để phân biệt sự kiện tiềm năng và stem đang mute.
- Nhạc qua bộ lọc một cực 2.200 Hz và stereo delay ngắn 137/173 ms, feedback 0,22, wet mặc định 12%, chỉnh 0–25%. Đây không phải mô phỏng phòng thật. Cue missing không qua hiệu ứng này. Valid zero không tự tạo cue. Smoothing/đuôi âm có thể kéo qua ranh giới; seek xóa bộ nhớ hiệu ứng.
- Gain theo số dải chọn, không tự normalize theo ROI hoặc cực đại mỗi frame. Giá trị đọc không chặn nhưng âm bão hòa ở audio_max A. Tăng voice hoặc đổi vùng có thể làm thay đổi tổng loudness.
- Thời gian phát là đường đi trong không gian của một snapshot; không phải diễn biến khí quyển theo thời gian. Tất cả mẫu hợp lệ được xét không có nghĩa nghe riêng được từng mẫu. IQR không phải độ bất định NASA. Không suy ra nguồn ô nhiễm hoặc nguy cơ sức khỏe.

## Căn cứ và kiểm chứng

Thiết kế học nguyên tắc phân vai cấu trúc và công bố lớp âm từ [NASA/Chandra Galactic Center](https://xrtpub.cfa.harvard.edu/sound/gcenter.html), [NASA Webb sonifications](https://science.nasa.gov/mission/webb/sonifications/), [NASA Open Science](https://science.nasa.gov/open-science/astronomy-data-sonification/). Đây là thiết kế riêng của BREATHE, không phải thuật toán GEOS-CF chính thức hoặc được NASA chứng nhận.

`npm.cmd run test:demo`: **30 test đạt**, gồm regression notebook/golden PCM và 5 test mới: derivative, chia cửa sổ/chọn sự kiện, phổ/âm vực, từng stem, missing/zero, reference solo, seek/reverse/preview và cả sáu trường NASA local ở hai hướng với 16 dải. Typecheck, lint và production build đạt; warning viewport metadata cũ vẫn còn. Không đổi backend nên không chạy lại toàn bộ backend suite trong lượt này.

Edge headless với profile riêng: preview dừng đúng 20 giây / source step 96 ở native ngang 5 phút; pause/resume giữ cursor; Solo phím gảy và reference hoạt động; JSON truy vết chứa source hash và cửa sổ phù hợp. Cả sáu chất phát được; chuyển dọc 16 voice, Scientific/legacy/context, Native Spectral và 3/5/7 phút không có exception ứng dụng. Các đoạn kiểm thử không chạm guard. Screenshot 1.440 px và 390 px đã được xem; không tràn ngang. Đây là kiểm tra chức năng và các đoạn ngắn, chưa phải đo dropout trên mọi thiết bị hoặc nghe nghiệm thu 3–7 phút.

Kiểm tra kỹ thuật không chứng minh chất lượng thưởng thức hoặc khả năng nhận biết dữ liệu. Cần người dùng đánh giá mức chói, độ dễ chịu, khác biệt giữa các lớp và khả năng nhận ra vùng nổi bật. Chưa đổi calibration khoa học hoặc suy ra temporal trend từ snapshot đơn lẻ.
