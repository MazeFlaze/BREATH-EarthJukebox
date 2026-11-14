# CODEX IMPLEMENTATION BRIEF — BREATHE Creator Studio

> **Mục đích:** Chỉ dẫn cho Codex kiểm tra repository BREATHE hiện tại, sau đó **tích hợp tăng dần** Creator Studio (tùy chỉnh phong cách/nhạc cụ, nghe preview, xuất WAV và chuẩn bị chia sẻ tác phẩm có visualization), **không viết lại ứng dụng từ đầu**, **không làm hỏng Scientific/Harmonic và ba Data Modes đang hoạt động**.
>
> **Trạng thái:** Implementation brief; **chưa phải tài liệu mô tả những tính năng đã có trong repository thực tế**. Phải thực hiện bước *inspect-first* trước khi sửa.
>
> **Ngôn ngữ làm việc:** Có thể giải thích và báo cáo bằng tiếng Việt; giữ identifier, API, types và code comments phù hợp quy ước dự án.

---

## 0. Lệnh khởi động cho Codex

Đặt tệp này ở **root repository** (hoặc cung cấp đường dẫn chính xác) và yêu cầu:

> **Read `CODEX_BREATHE_CREATOR_STUDIO_IMPLEMENTATION.md` fully. Inspect the existing BREATHE codebase before editing. Implement the smallest compatible Creator Studio vertical slice first (P0), reusing the current scientific-event contracts, existing audio lifecycle, map and UI components. Do not invent missing APIs or dataset values. Keep Scientific Mode and Harmonic Mode working. Report your audit, changes, manual verification steps, and known limitations. Do not commit/push, add unapproved dependencies, or execute tests/build/lint without explicit permission.**

**Quy tắc thực thi:** Sau khi khảo sát, nếu repo đủ rõ để triển khai, bắt đầu P0 mà không cần tạo project phụ. Nếu thiếu tài nguyên thiết yếu (contract thật, audio engine, giao diện, quyền truy cập), không bịa khả năng; ghi rõ blocker, nêu phương án adapter nhỏ nhất, và chỉ thực hiện phần an toàn.

## 1. Bối cảnh sản phẩm và mục tiêu

### 1.1 Sản phẩm

**BREATHE / The Earth Information Jukebox** là ứng dụng khám phá dữ liệu khí quyển NASA dưới dạng bản đồ, số liệu và âm thanh. Nguồn R&D hiện tại:

- **Dataset:** NASA GEOS-CF v2, collection `aqc_tavg_1hr_glo_L1440x721_slv` (analysis).
- **6 variables:** `pm25_rh35`, `pm10_rh35`, `co`, `no2`, `o3`, `so2`.
- **Đơn vị hiển thị:** PM2.5/PM10 = µg/m³; CO = ppmv; NO₂/O₃/SO₂ = ppbv (bảo toàn đơn vị gốc và hệ số chuyển đổi).
- **Data Mode A:** Region-based A/B comparison.
- **Data Mode B:** Global Scan, demo 4 dải vĩ độ × 8 dải kinh độ = 32 ô G01–G32, tuyến quét zíc-zắc từ Bắc xuống Nam.
- **Data Mode C:** Temporal, theo timestamps đã được kiểm chứng (không dựng chuỗi NASA giả từ một snapshot).
- **Audio Mode:** Scientific (data carrier) và Harmonic (cùng carrier + lớp hòa âm).
- **R&D references (nếu repo có hoặc được người dùng cung cấp):**
  - `BREATHE_GEOS_CF_v2_Six_Pollutants_Scientific_Harmonic_RnD_Web_Guide.ipynb` — nguồn đối chiếu mới nhất cho event schema, mapping, hysteresis, seek/reverse và bàn giao web.
  - `GEOS_CF_v2_Six_Pollutants_Three_Modes_Artistic_Soundscape_Demo.ipynb` — tham khảo về âm sắc, scan, offline soundscape.
  - `NASA_Space_Apps_HCMC_2026_Hackathon_Runbook (1).docx` và `Earth_Information_Jukebox_Resource_Plan.md` — mục tiêu, provenance, accessibility.

**Cảnh báo:** Các notebook là nghiên cứu và mã Python offline. Không giả định code Python đã được port nguyên vẹn sang browser hoặc có sẵn trong repository. Hãy đọc implementation hiện tại và adapter cho phù hợp.

### 1.2 Định vị và persona

Đề xuất tính năng **Creator Studio: “Turn Earth’s Data Into Your Own Soundscape.”** Không chỉ dành cho nghệ sĩ. Persona ưu tiên là **Creative Learners** (học sinh/sinh viên thích khám phá và sáng tạo), kế tiếp **Science Communicators / Content Creators**, sau đó **Music Enthusiasts / Sound Artists**. Lợi ích sản phẩm: **Explore → Learn → Create → Share**, không cạnh tranh trực tiếp với DAW như Ableton/FL Studio.

### 1.3 Mục tiêu có thể nghiệm thu

1. Chọn dataset selection có sẵn (chất, vùng hoặc chuỗi thời gian, global scan); không tạo số liệu NASA giả.
2. Nghe cùng data events bằng **Scientific** và **Harmonic/Creative**; thay preset/instrument không thay đổi giá trị khoa học hoặc event identity.
3. Cho thay đổi một số lựa chọn sáng tạo: style, nhạc cụ/voice, tempo, bật/tắt music layers, cân bằng data/music, nhưng vẫn có Data-only A/B.
4. Preview với Play/Pause/Resume/Stop/Seek/Reverse, bản đồ/timeline có vị trí đang nghe và phần **“Why did the sound change?”**.
5. **P0:** xuất WAV và tải recipe/manifest JSON có provenance. **P1:** xuất một đoạn audiovisual WebM nếu nền tảng hỗ trợ. **P2:** share link và remix có backend thực tế, không tạo nút “Share” giả.

---

## 2. BẮT BUỘC: Inspect-first, compatibility-first

**Trước khi chỉnh sửa:** đọc repo thật và tóm tắt đường dẫn thực tế (không tự khẳng định repo dùng tên file phía dưới).

### 2.1 Inventory

- `package.json`, package manager lockfile, `tsconfig`, Next.js app/pages router, React version; repo có mono-repo không.
- `src/`, `app/`, `pages/`, `components/`, `hooks/`, `lib/`, `services/`, `public/`, `data/`, `api/` nếu có; tìm route BREATHE hiện hữu.
- Audio: nơi tạo/đóng `AudioContext`, Web Audio nodes, Tone.js (nếu đã cài), scheduler, WAV export, play/pause/stop, seek/reverse, timers, gain và cleanup.
- Data: shape JSON thực, parser/validator, schema version, cách lấy six variables, scientific frozen events, calibration, source hash/timestamp, missing/zero.
- Visualization: bản đồ đang dùng Leaflet/MapLibre/Canvas/PNG/tiles; vùng hiện tại và cursor Gxx/timestamp đồng bộ ra sao.
- UI: design system, styles, localization vi/en, accessibility, state management, feature flags, test conventions.
- Rà lỗi phiên bản/field bị drift giữa notebook `web_harmonic_contract_*` và types trong repo.

### 2.2 Audit note trước khi sửa

Viết ngắn gọn trong kết quả thực thi:

```text
Existing pages/routes: ...
Current audio controller + lifecycle: ...
Current scientific event shape: ...
Map/timeline mechanism: ...
Reuse points: ...
Data/feature blockers: ...
Files proposed for edits: ...
```

**Không tạo `new AudioContext()` mỗi lần đổi preset hoặc đổi chord. Không tạo audio engine thứ hai nếu có thể mở rộng controller hiện tại bằng renderer/preset adapter.** Không viết lại map, design system, routing hoặc data pipeline nếu không cần.

### 2.3 Quy tắc repository

- Ưu tiên tuân thủ folder/import/style conventions hiện có. Cây file ở §11 chỉ là ví dụ.
- Thay đổi nhỏ, có feature flag/route rõ ràng; không sửa unrelated code; giữ API cũ khi có thể.
- Không tự ý tải thư viện nhạc/sample hay thêm dependencies. Nếu cần, nêu lý do và chờ duyệt.
- Không commit, không push, không tạo branch/PR, không thay dữ liệu nguồn NASA.
- **Theo ràng buộc hiện có:** viết bổ sung unit tests và manual QA, nhưng **không tự chạy tests/build/lint** nếu người dùng chưa cho phép. Báo rõ các kiểm tra chưa chạy.
- Không bật upload/public sharing, analytics, microphone, account/permission mới ngoài phạm vi P0.

---

## 3. Ranh giới dữ liệu khoa học và sáng tạo — NON-NEGOTIABLE

### 3.1 Một nguồn sự thật

```text
GEOS-CF .nc4 (offline / server)
  → validated scientific values, units, geometry, timestamp
  → normalized score + immutable Scientific/Frozen Events
  → shared playback timeline
       ├── SCIENTIFIC render: same data-carrier events
       └── HARMONIC/CREATIVE render: same carrier + musical layers
  → synchronized map, captions, explanation, export metadata
```

**Không tái chuẩn hóa theo genre/instrument. Không sửa source values khi remix.** `source_sha256`, `mapping_version`, `calibration_version`, `event_id`, `canonical_index`, `timestamp_utc`, `region_id/scan_id`, `value`, `unit`, `score`, `pulses`, `missing` phải có thể truy ra nguồn gốc.

Nếu user chọn **dữ liệu khác** (vùng, chất, time window), đây là *data selection change* cần nạp/cấp frozen events mới, không phải thay creative recipe. Không ẩn việc thay nguồn.

### 3.2 Fixed mapping / per-pollutant scale

Theo notebook R&D, mỗi chất có `audio_max` riêng và công thức kiểu `score = clip(value/audio_max, 0, 1)`, `pulses(0)=0`, `pulses(x>0)=ceil(5*score)`; **giá trị bị saturation không được sửa thành audio_max**. Những thang demo trong notebook chỉ phục vụ R&D, **không phải AQI, mức an toàn, hay chuẩn độc hại**.

- CO ppmv **không** so trực tiếp với NO₂ ppbv hay PM µg/m³.
- Không cộng/average các concentration khác đơn vị để làm “global pollution score”.
- `0` là dữ liệu hợp lệ; `null/missing` là không có dữ liệu, cần cue và thông báo khác.
- “Serenity”, “Uncertainty”, “Disturbance”, “Alert” là **nhãn nghệ thuật**; không phải mức cảnh báo sức khỏe. “Uncertainty” không đại diện cho độ không chắc chắn của mô hình.
- Collection AQC **không có AOD**; không sao chép AOD prompt sang sáu biến hiện tại.
- Không gắn hình EIC năm 2024 như thể mô tả đúng snapshot GEOS-CF 2026.

### 3.3 Invariant: data-carrier must survive creation

Với **cùng FrozenEvent plan + cùng playback timeline**, scientific carrier gồm **cùng sự kiện và lịch tương đối** trong Scientific/Harmonic/Creative. Chỉ lớp nhạc bổ sung, nhạc cụ và hiệu ứng nghệ thuật được thay. `dataGain` phải điều khiển độc lập với `musicGain`; mặc định data layer đủ nhận biết.

Nếu user chỉnh tempo, **playback timestamps có thể thay đổi**; đó là tái sắp xếp thời lượng biểu diễn (không đổi canonical order, source time và các giá trị). Khi so sánh hai Audio Modes ở cùng tempo/config, carrier phải giữ đúng.

### 3.4 Thứ tự quét và Reverse

- **Spatial scan:** G01→G32 theo canonical serpentine route (4×8) từ Bắc xuống Nam; reverse phát G32→G01 nhưng mỗi Gxx vẫn giữ scientific values, score, mood/chord/note đã tính theo canonical plan.
- **Temporal:** `chronological_delta` và mood/hysteresis tính theo **UTC tăng dần** và freeze trước khi playback; reverse chỉ đảo event order, không đổi hướng khoa học của delta.
- **Seek:** chỉ chọn `event_id` / `canonical_index`, hủy lịch chưa phát, reschedule từ index; không reverse PCM/WAV samples.
- UI luôn ghi `playback_direction`, current `scan_id`/timestamp, chất, đơn vị và mô tả “spatial contrast” khác “temporal trend”.

---

## 4. Product scope theo thứ tự ưu tiên

| Phase | Ưu tiên | Yêu cầu | Không làm trong phase |
|---|---|---|---|
| **P0 – Creator Lite** | **BẮT BUỘC** | Tích hợp route/panel Create; chọn data selection hiện có; Scientific ↔ Harmonic; 3–4 presets; 2–3 lead voices; tempo; toggle music layers; Data-only; map/timeline synced; `Why this sound?`; **WAV export + JSON recipe** | User accounts, share server, video MP4, DAW, AI composer |
| **P1 – Audiovisual export** | Kế tiếp nếu P0 ổn | Short clip WebM với map/time cursor + waveform/score/narrative + audio đồng bộ, hỗ trợ nếu browser có codec | Bảo đảm MP4 trên mọi browser, server transcoding tự động |
| **P2 – Save/share/remix** | Roadmap | Persist recipe + immutable reference; share link khi có backend/auth/storage thật; Remix tạo recipe mới nhưng giữ provenance | Công khai mặc định, duplicate full NASA dataset, social network |
| **P3 – Producer tools** | Tương lai | Stems, MIDI, user presets, sample library có license, advanced mixer | MVP hackathon |

**Gating:** P0 phải tạo ra một end-to-end vertical slice hoạt động với *event JSON thật hoặc test fixture được gắn nhãn*, trước khi thêm P1/P2. Nếu current app chưa có Scientific/Harmonic browser engine, port/adapter **tối thiểu** trước, không bắt đầu bằng video exporter.

---

## 5. P0 UI/UX và chức năng chi tiết

### 5.1 Entry point

- Thêm tab/route `Create` hoặc panel trong BREATHE (theo routing hiện có); giữ `Explore` và `Learn` nguyên vẹn.
- Một flow: **Choose data → Choose sound → Preview → Understand → Export**.
- Ưu tiên người học/creative explorer: presets dễ hiểu, tooltips giải thích khái niệm; advanced options đặt sau disclosure.
- Có **Back to Scientific** và **Reset Creative Settings**; không reset dataset gốc.

### 5.2 Controls đề xuất

| Control | MVP behavior | Điều kiện |
|---|---|---|
| Data Mode | `region` / `global_scan` / `temporal` | Mode C chỉ enabled nếu ≥2 timestamp NASA hợp lệ theo contract |
| Pollutants | 1 trong 6, hoặc tối đa 2 trong mix sau | Có labels và đơn vị riêng; không dùng score liên chất như risk ranking |
| Audio Mode | Scientific / Harmonic | Creative preset chỉ tác động Harmonic/music layers |
| Genre preset | `ambient`, `lofi`, `cinematic`, `minimal-electronic` | Genre-*inspired* synthesizer config, không phát copyrighted song |
| Lead voice | `warm-pad`, `soft-piano-synth`, `bell-synth`, `pluck-synth` | Dùng built-in synthesis/asset có license; chỉ tên instrument approximation |
| Tempo | ví dụ 60–120 BPM | Bảo toàn canonical events, cập nhật duration/pacing; đánh dấu khác thời gian NASA |
| Layers | `bass`,`chord`,`melody`,`texture` enable/disable | `carrier` luôn có; có nút Data-only để A/B |
| Music Mix | 0–1; preset mặc định thấp | `dataGain` độc lập, tránh mask carrier |
| Sound preview | Play/Pause/Resume/Stop, Next/Previous/Seek, Reverse | Đồng bộ UI map/timeline, hỗ trợ keyboard |
| Export | WAV + recipe JSON | Disable với dữ liệu missing/không có quyền export; báo lý do |
| Explanation | Scientific value, normalized score, pulse count; layer/genre mapping | Không dùng nhãn mood để diễn giải sức khỏe |

Thêm loading, empty state, unavailable media, render progress (nếu API trả progress thật), lỗi export và công tắc giảm chuyển động. Không dùng icon-only buttons mà thiếu accessible name; âm thanh phải do user gesture kích hoạt, không autoplay.

### 5.3 “Why did the music change?”

Với mỗi `event_id`, UI trình bày:

1. **Science:** biến, giá trị gốc, đơn vị, vùng/timestamp, nguồn GEOS-CF + model estimate.
2. **Mapping:** normalized score + phiên bản calibration; carrier pulse count; saturation/missing nếu có.
3. **Music:** preset, active instrument/layers, chord/mood/melody note và dữ liệu nào điều khiển tính chất nào.
4. **Boundary:** `artistic interpretation only`, không phải AQI/medical warning; link về source/provenance.

Không chỉ nói “âm thanh trở nên căng thẳng” mà không có giải thích từ giá trị gốc.

---

## 6. Audio architecture: reuse existing engine

### 6.1 Kiến trúc mong muốn (adapter, không áp đặt tên file)

```text
Existing scientificEvent provider / FrozenEvent[]
             |
      immutable TimelineBuilder
             |
        AudioController  ← existing playback lifecycle
          /       \
 scientificCarrier   harmonicRenderer ← creative preset/voice/layers
          \       /
         master mixer (+ optional limiter)
             |
     live AudioContext / OfflineAudioContext
             |
   speakers / WAV export / media destination
```

**Single source of scheduling truth:** cả live preview và offline export đi qua **cùng logic dựng event/timeline**, chỉ đổi audio sink/context nếu hợp lý. Tránh một renderer tự tính nhạc khác hoàn toàn khi export.

### 6.2 Musical presets là cấu hình, không phải background tracks

Nên quản lý preset registry dưới dạng dữ liệu:

```typescript
export type MusicPresetId =
  | 'ambient' | 'lofi' | 'cinematic' | 'minimal-electronic';

export interface CreativeRecipe {
  schemaVersion: 'breathe-creative-recipe-v1';
  presetId: MusicPresetId;
  instrumentId: 'warm-pad' | 'soft-piano-synth' | 'bell-synth' | 'pluck-synth';
  tempoBpm: number;
  layers: { bass: boolean; chord: boolean; melody: boolean; texture: boolean };
  dataGain: number;
  musicGain: number;
  seed: number;
  // Derived properties and non-musical scientific data MUST NOT be edited here.
}
```

`dataGain` là điều khiển nghe, không thay scientific event values; nên có nút “Data-only” để cô lập carrier. Preset định nghĩa instrument timbre (waveform/envelope/filter), rhythmic arrangement, chord voicing và effect settings; không tự đổi source values, data score, canonical order, event IDs.

Preset ví dụ (cần điều chỉnh theo UX, không phải nhạc lý duy nhất):

- Ambient: long envelopes, airy pad, sparse musical rhythm.
- Lo-fi: mellow pluck, short beat, soft filtering.
- Cinematic: sustained bass/chord layering, gradual swells.
- Minimal Electronic: pulse-oriented synth, simple motifs.

**Harmonic compatibility:** giữ hệ thống chord/mood hiện có nếu repo đã port từ R&D. Không ép toàn bộ hợp âm Cmaj7/Fmaj7/G, Am7/Dm7/Em, Dm/Bb/Gm/A7, Cm/Ab/Fm/G7 vào một C-major pentatonic duy nhất: các progression không cùng tập pitch classes. Chọn note set hợp lệ cho mỗi preset/state, tránh dissonance ngoài ý muốn. Nếu có seeded micro-variation, đảm bảo determinism ở event-plan level.

### 6.3 Audio lifecycle

- Một shared live `AudioContext` / context factory trong existing engine; khởi tạo/resume trực tiếp khi click/tap Play.
- Lịch audio theo `audioContext.currentTime`; sử dụng look-ahead cho chuỗi dài; UI playhead theo audio clock chứ không dựa hoàn toàn vào `setInterval`.
- Playback generation token: stop/seek/reverse/mode change phải invalidate callback cũ, stop/disconnect scheduled voices và reschedule.
- `pause` có semantics rõ: suspend/resume hoặc playback cursor logic; `stop` về đầu; `seek` dời cursor; không dùng `suspend()` giả làm stop.
- Envelope attack/release, crossfade ở boundary, gain staging; giới hạn đồng thời oscillators, xử lý node disposal và component unmount.
- Khi audio mode chuyển, không reset data selection. Nếu đang phát, chọn chiến lược rõ (pause & rebuild hoặc crossfade at bar boundary), đồng bộ lại hiển thị.
- Missing ≠ 0: không tạo “êm dịu” khi thiếu data; có marker/thông báo.

---

## 7. Web export: scientific integrity + technical constraints

### 7.1 P0: WAV offline (phải có)

Mục tiêu: preview và bản WAV được xây dựng từ **cùng canonical events / creative recipe / engine mapping version**.

1. Freeze current `FrozenEvent[]` + chosen selection, direction, timeline config + `CreativeRecipe`.
2. Tạo/sử dụng offline graph trong `OfflineAudioContext` (hoặc API offline trong engine hiện tại), schedule events đúng timeline.
3. `startRendering()` trả về `AudioBuffer`; chuyển PCM sang WAV (định dạng, sample rate, số kênh, kích thước được công bố).
4. Kiểm tra peak/headroom và null/missing; limit export duration/memory; revoke Object URLs.
5. Trigger tải file qua hành động user; xuất thêm `*.recipe.json`/`*.manifest.json` có provenance. Đặt tên an toàn theo slug/date/mode, không nhét dữ liệu nhạy cảm vào filename.
6. Nếu xuất Scientific và Harmonic của cùng selection, kiểm thử carrier events giống nhau dù PCM mix khác nhau.

Gợi ý: **WAV trước, MP3 sau**. Không hứa MP3 nếu chưa có codec/license phù hợp. Không phát sinh sample có bản quyền mà không có quyền tái phân phối.

### 7.2 P1: Audiovisual WebM

- Không dùng trực tiếp ảnh PNG Matplotlib có trục/colorbar như georeferenced map overlay. Dùng visual renderer có tọa độ đúng trong UI.
- Một **canonical playback timeline** quyết định visual cursor, event ID, timestamp, captions và audio; khi quay video, cả hai lấy cùng kế hoạch biểu diễn.
- Cân nhắc `HTMLCanvasElement.captureStream()` và `MediaStreamAudioDestinationNode`, ghép tracks qua `MediaStream`, sau đó `MediaRecorder` (feature-detect `MediaRecorder.isTypeSupported`).
- Capture canvas có thể bị **tainted** khi chứa tài nguyên cross-origin không có CORS hợp lệ. Có fallback dùng locally hosted authorized assets.
- Browser/codec khác nhau; ưu tiên **WebM nếu được hỗ trợ**, không hứa MP4 trên mọi trình duyệt. Nếu unsupported, hiển thị lỗi có ý nghĩa và cung cấp **WAV + PNG + JSON** thay thế.
- Giới hạn MVP clip ngắn (ví dụ 15–30 s) để tránh memory/performance issues; kiểm tra audio/video drift, seek/reverse, video dimensions và nguồn/citation trong frame hoặc end card.

### 7.3 P2: Interactive Share / Remix (chỉ triển khai nếu backend thực)

- Tác phẩm = **immutable data snapshot/reference** + mutable **CreativeRecipe** + preview metadata, không copy toàn bộ `.nc4` lên client.
- Link công khai phải giữ `source`, `sha256`, `timestamp/period`, `selection`, `mapping_version`, `calibration_version`, `engine_version`, `preset_version`, `scan_order`, `direction`, license/attribution.
- `Remix` fork recipe với `parentArtworkId`/`sourceArtworkId` nhưng không sửa original frozen events. Nếu sửa data selection, trở thành artwork mới với provenance cập nhật.
- Không ghi dữ liệu cá nhân/voice recording trừ khi người dùng biết và chủ động đồng ý. Default project private nếu có tài khoản.
- Handle hosting permission, upload size, link access, deletion, moderation/abuse và storage lifecycle; nếu chưa có backend thì **không dựng API giả hoặc link share bấm không hoạt động**.

---

## 8. Schema tích hợp / contract — ưu tiên adapter cho schema thực

**Không thay thế schema R&D đang được frontend dùng bằng schema mới mà không migration.** Nếu `FrozenEvent` đã có trong app, extend hoặc tạo view-model adapter, không duplicate data values.

### 8.1 Types gợi ý

```typescript
export type DataMode = 'region' | 'global_scan' | 'temporal';
export type AudioMode = 'scientific' | 'harmonic';
export type Direction = 'forward' | 'reverse';

export interface ScientificIdentity {
  sourceId: string;
  sourceFileSha256: string | null;
  variable: 'pm25_rh35' | 'pm10_rh35' | 'co' | 'no2' | 'o3' | 'so2';
  unit: string;
  timestampUtc: string;
  geometryId?: string;
  mappingVersion: string;
  calibrationVersion: string;
}

export interface PlaybackSelection {
  dataMode: DataMode;
  pollutantIds: ScientificIdentity['variable'][];
  regionIds?: string[];
  scanCursor?: string;
  temporalRangeUtc?: [string, string];
  direction: Direction;
}

export interface CreatorArtworkManifest {
  schemaVersion: 'breathe-artwork-v1';
  artworkId?: string;
  title: string;
  description?: string;
  source: ScientificIdentity[];   // or a canonical data source reference
  selection: PlaybackSelection;
  eventPlanHash: string;
  eventCount: number;
  creativeRecipe: CreativeRecipe;
  engineVersion: string;
  export?: { audioMime?: string; videoMime?: string; durationSeconds?: number };
  isSyntheticFixture: boolean;
  warnings: string[];
}
```

**Schema minh họa;** implement theo types đã có và validation lib đang dùng. Không nhét toàn bộ 1.038.240 ô NASA/global field vào frontend JSON. R03 chuẩn bị subset/frozen events đã được kiểm chứng.

### 8.2 JSON nguồn đối chiếu từ notebook

Notebook R&D có các thành phần/khái niệm:

- `schema_version: breathe-harmonic-events-v1` (ở artifact JSON R&D), `mapping_version`, `calibration_version`.
- `FrozenEvent` theo `event_id`, `canonical_index`, `scientific: {pollutant, scan_id, timestamp_utc, value, unit, score, pulses, source_sha256}`; ngoài ra có `artistic_mood`, `chord_name`, `chord_midi`, `melody_midi`, `bass_midi`, `variation_kind`.
- Chú thích dữ liệu `synthetic` vs `nasa` và trạng thái thiếu timestamp trong Mode C.

**CODEx:** đọc file JSON hiện có (không đoán camelCase) và viết adapter/validator có test case. Nếu R&D ghi snake_case, có thể normalize sang camelCase tại API boundary. Không âm thầm bỏ `missing`, version hoặc SHA.

### 8.3 Project/recipe JSON phải đủ để tái tạo

Tối thiểu: `source`, `geometry/scan IDs`, `timestamp/time range`, `eventPlanHash`, `event order`, `direction`, `schema/mapping/calibration/engine/preset versions`, `creativeRecipe`, `seed`, `license/attribution`, `synthetic flag`.

*Deterministic* nghĩa là cùng frozen events/config/seed cho ra cùng **event-level music plan**. Không cam kết WAV bit-identical giữa mọi browser, sample rate, audio hardware và phiên bản synth nếu chưa kiểm chứng.

---

## 9. Ràng buộc khoa học, an toàn âm thanh và UX

1. GEOS-CF là **model-estimated** atmospheric composition, không phải số đo trạm tại mỗi tọa độ; không tự gọi là chỉ số phơi nhiễm của con người.
2. Không diễn giải “Serenity/Alert”, preset Cinematic/Lo-fi, số xung hay normalized score thành cảnh báo AQI/sức khỏe.
3. Mỗi chất có đơn vị/calibration riêng. Nếu tác phẩm chứa hai chất, không kết luận chất có nhiều xung hơn là nguy hại hơn.
4. Visual/audio cùng biến, vùng, timestamp; scan Gxx là tương phản **không gian** (không phải biến đổi theo thời gian). Reverse Mode C phải giữ chronology metadata.
5. Nhạc có thể làm mất khả năng phân biệt signal. Có `Data-only`, `Music mix` và Scientific A/B; không ép người dùng nghe nhạc nền.
6. Giới hạn digital peak, attack/release, layer count; âm lượng mặc định thấp. Peak kỹ thuật không thay thế kiểm thử nghe thực tế.
7. Thiết kế keyboard-first: labels, focus order, live announcements hữu ích nhưng không spam; giảm chuyển động, caption, text explanation, screen reader compatibility.
8. Các assets sample/visual phải có license cho việc **xuất bản remix**, không chỉ license sử dụng nội bộ. Ưu tiên synth gốc cho P0.
9. Không ngụ ý NASA tài trợ/chứng thực sản phẩm. Ghi đầy đủ nguồn GEOS-CF/SVS theo hướng dẫn NASA.
10. Chỉ thực hiện feature thực sự hoạt động; unsupported export phải báo rõ và fallback, không fake-success.

---

## 10. Checklist tests & acceptance criteria

**Viết test phù hợp framework có sẵn nhưng không tự chạy nếu chưa được người dùng đồng ý.** Nếu chưa có test runner, ít nhất cung cấp test cases/manual reproducible steps.

### 10.1 Scientific invariants

- [ ] Đổi genre/instrument/layers **không sửa** `value`, `unit`, `event_id`, `canonical_index`, `score`, `pulses`, `source_sha256`, `calibration_version` của frozen event.
- [ ] Scientific/Harmonic với cùng selection/tempo share data-carrier schedule; solo carrier nghe được tín hiệu gốc.
- [ ] Missing không bị biến thành zero; không dựng mood hoặc hòa âm như thể có dữ liệu NASA hợp lệ.
- [ ] Hai vùng A/B cùng variable dùng chung mapping version; six variables có đơn vị/config riêng.
- [ ] Reverse G32→G01 giữ mapping của mỗi Gxx; seek giữa chừng không đảo waveform; chênh lệch temporal theo UTC gốc.
- [ ] Source `synthetic` được ghi nhãn rõ; không gọi số liệu synthetic là NASA.

### 10.2 Audio/Export behavior

- [ ] Play, Pause, Resume, Stop, Seek, Next, Previous, Reverse hoạt động ổn trong hai mode; no duplicated audio after repeated switching.
- [ ] Chuyển preset không tạo `AudioContext` mới không cần thiết; cleanup đúng khi unmount.
- [ ] Preset thực sự khác âm sắc/arrangement; cùng dữ liệu tạo data plan giống nhau.
- [ ] Renderer live và renderer export dùng cùng timeline/scheduler semantics; WAV duration phù hợp.
- [ ] WAV hợp lệ, xuất được offline; metadata recipe/manifest tương ứng với file và time range xuất.
- [ ] Nếu không hỗ trợ video/codec, UI không hiện nút inert hoặc báo đã thành công.
- [ ] Khi P1 bật: Video highlight Gxx/timestamp đúng sự kiện đang phát, không trôi âm-hình đáng kể trong demo.

### 10.3 Accessibility / scientific explanation

- [ ] User chọn vùng/chất, đổi preset, nghe và xuất bằng bàn phím, không cần click chính xác lên bản đồ.
- [ ] `Why did the sound change?` có nguồn, đơn vị, normalized mapping, giải thích musical parameters.
- [ ] Không nói “high O₃ means more dangerous than PM2.5” chỉ vì score cao hơn.
- [ ] Product text phân biệt `artistic mood` và `health alert`; không tự tuyên bố cảnh báo sức khỏe.

### 10.4 User journeys (manual)

**Journey A (Educational Creator):** Chọn PM2.5 → Mode A → Scientific A/B → Harmonic → Ambient → Piano Synth → Preview → Data-only → Export WAV + Recipe. Kiểm tra tính nhất quán các giá trị A/B và mối liên kết âm.

**Journey B (Global Creator):** Mode B → G12 → G17 → Lo-fi → Reverse → Save WAV → mở recipe JSON → dữ liệu của Gxx không đổi, hướng phát được ghi lại.

**Journey C (Temporal):** Nếu có ít nhất 2 timestamp NASA thật, chọn time series → nghe forward/reverse; nếu chỉ một file thì hiển thị thiếu dữ liệu chứ không phát fake NASA animation.

**Journey D (P1 video, nếu triển khai):** Xuất đoạn 15–30s, kiểm tra WebM bằng player có sẵn, ảnh có source/attribution và Gxx/timestamp đồng bộ.

### 10.5 Definition of Done — P0

- [ ] Tất cả route cũ và Scientific/Harmonic modes không bị thay đổi hành vi bất ngờ.
- [ ] Creator Studio dùng **chính event provider và audio controller hiện tại** (hoặc adapter nhỏ có giải thích).
- [ ] Có ít nhất **3 presets** và **2 voices** nghe khác nhau; options hoạt động thật.
- [ ] Có **data-only**, các controls cơ bản, timeline/map sync và explanation panel.
- [ ] WAV export + recipe JSON chạy được trên browser mục tiêu, hoặc có blocker cụ thể được báo trung thực.
- [ ] Đã tạo QA cases và hướng dẫn test; không claim test PASS nếu chưa chạy.
- [ ] Có documentation cập nhật, giới hạn science và nguồn dữ liệu.

---

## 11. Gợi ý cấu trúc file (CHỈ KHI phù hợp repository)

**Không tạo hàng loạt file dưới đây nếu dự án đã có module tương đương.** Ưu tiên extend tên/type hiện hữu.

```text
src/
  features/creator/
    components/CreatorStudio.tsx
    components/CreativeControls.tsx
    components/ScienceExplanation.tsx
    hooks/useCreatorSession.ts
    presets/creativePresets.ts
    types/creator.ts
    utils/creatorValidation.ts
  lib/audio/
    ...existingSharedAudioController.ts
    ...existingScientificCarrier.ts
    creativeRenderer.ts              # chỉ nếu chưa có renderer tương đương
    offlineWavExporter.ts            # tái dùng scheduler
  lib/data/
    ...existingFrozenEventAdapter.ts
  lib/export/
    audiovisualExporter.ts           # P1 only
    artworkManifest.ts
  app/create/page.tsx                 # CHỈ nếu dùng App Router và route này phù hợp
```

Nếu sử dụng Pages Router, domain-driven folders, Zustand/Redux hay một component library có sẵn, thay cấu trúc mẫu bằng quy ước thật. Không add backend nếu P0 chỉ cần local WAV export.

---

## 12. Implementation order (vertical slices)

### Step 0 — Audit (không sửa hành vi)

- Kiểm tra repo và các paths, chọn điểm tích hợp ít tác động nhất.
- Kết luận có sẵn Scientific/Harmonic trên browser hay chỉ có WAV notebook.
- Xác định `FrozenEvent` provider; nếu contract khác, viết adapter strategy.

### Step 1 — Thin Creator UI + state

- Dùng existing event selector/audio playback. Thêm trang/panel Create, controls có tác dụng thật, preset config registry, safe defaults.
- Thêm feature flag nếu project hỗ trợ; không can thiệp Explore/Learn.

### Step 2 — Reuse Scientific/Harmonic engine

- Port/extend minimal renderer nếu thiếu, giữ data carrier; `CreativeRecipe` chỉ quyết định nhạc cụ/phối âm.
- Map/voice selection, timeline và explanation cùng `event_id`.

### Step 3 — Audio export P0

- Offline WAV + companion manifest/recipe, event plan frozen, no cross-layer hidden mutations.
- Xử lý errors, empty/missing data, duration and memory limits.

### Step 4 — QA documents and handoff

- Tạo test cases/manual steps, cập nhật README/developer docs, liệt kê source/license và known issues.
- Chốt P0 nếu acceptance đã đáp ứng; chỉ bắt đầu P1 nếu người dùng yêu cầu hoặc task scope cho phép rõ ràng.

### Step 5 — P1/P2 optional

- P1: short WebM capture, correct synchronization; graceful fallback.
- P2: public links / remix **khi đã có hạ tầng lưu và kiểm soát quyền**.

---

## 13. Báo cáo kết quả CODEx phải gửi lại

1. **Audit:** kiến trúc hiện tại và điểm tái sử dụng, những giả định nào được xác nhận/không xác nhận.
2. **Files changed:** danh sách đường dẫn thực tế, mỗi file một dòng mô tả tác dụng.
3. **Implemented:** tính năng P0 nào đã hoạt động, P1/P2 nào chưa làm.
4. **Data integrity:** cách đảm bảo frozen scientific event/normalization/source provenance không bị thay.
5. **Audio lifecycle:** một shared context, scheduler, mode switching, cleanup và behavior seek/reverse.
6. **Export architecture:** WAV thực sự xuất từ đâu, recipe liên kết thế nào, video/share nếu có.
7. **Manual verification:** hướng dẫn cụ thể chạy trên Windows/Chrome/Edge với fixture hoặc NASA thật, không tự tuyên bố pass khi chưa kiểm thử.
8. **Known issues / risks:** codecs, CORS, missing data, latency, copyright/licensing, performance.
9. **Next safe iteration:** một đề xuất nhỏ nhất và có thể kiểm chứng.

**Đừng trả lời chỉ bằng mockup hoặc code snippet.** Nếu có quyền thao tác repo, sửa file thực trong phạm vi được phép và báo kết quả. Không đánh đồng đã viết code với đã chạy qua browser QA.

---

## 14. Official technical references (for implementation lookup)

- MDN — [Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices) — user gesture/autoplay, audio graph.
- MDN — [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext) và [`startRendering()`](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext/startRendering) — offline WAV buffer.
- MDN — [MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) và [`isTypeSupported()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static) — codec detection.
- MDN — [`HTMLCanvasElement.captureStream()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream) — visual stream capture.
- MDN — [MediaStreamAudioDestinationNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode) — audio track capture.
- NASA — [GEOS-CF documentation](https://gmao.gsfc.nasa.gov/gmao-products/geos-cf/documentation_geos-cf/) — scientific variables and limitations.
- NASA — [Data citation guidance](https://gmao.gsfc.nasa.gov/gmao-products/geos-cf/citing-geos-cf-data_geos-cf/).

> **Final principle:** **Create freely, preserve the science.** BREATHE là công cụ giúp người dùng tự thiết kế cách *thể hiện* dữ liệu Trái Đất, không phải công cụ tự thay đổi dữ liệu Trái Đất.
