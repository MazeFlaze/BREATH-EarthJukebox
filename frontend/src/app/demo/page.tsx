"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, AudioLines, Check, ChevronLeft, ChevronRight, Globe2, Headphones, Pause, Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { NotebookDemoAudio } from "@/services/notebookDemoAudio";
import type { AudioMode, DataMode, DemoState, Direction, FrozenEvent, NotebookDemoContract, Pollutant } from "@/types/notebookDemo";
import styles from "./demo.module.css";

const KEYS: Pollutant[] = ["pm25_rh35", "pm10_rh35", "co", "no2", "o3", "so2"];
const SHORT_NAMES = ["PM2.5", "PM10", "CO", "NO₂", "O₃", "SO₂"];
const valueText = (value: number | null) => value === null ? "Thiếu dữ liệu" : value.toLocaleString("vi-VN", { maximumSignificantDigits: 5 });

function MapView({ events, active, image, onSelect }: {
  events: FrozenEvent[]; active: FrozenEvent; image: string; onSelect: (index: number) => void;
}) {
  const region = active.variation_kind === "region_comparison";
  return <svg viewBox="0 0 1000 500" className={styles.map} aria-label="Bản đồ nồng độ GEOS-CF và các vùng có thể chọn">
    <image href={image} width="1000" height="500" preserveAspectRatio="none" />
    {events.map((event, index) => {
      const { lat, lon } = event.scientific.bounds;
      const x = (lon[0] + 180) / 360 * 1000, y = (90 - lat[1]) / 180 * 500;
      const width = (lon[1] - lon[0]) / 360 * 1000, height = (lat[1] - lat[0]) / 180 * 500;
      const selected = active.event_id === event.event_id;
      return <g key={event.event_id} role="button" tabIndex={0} aria-label={`Chọn ${event.scientific.scan_id}, ${valueText(event.scientific.value)} ${event.scientific.unit}`}
        aria-pressed={selected} onClick={() => onSelect(index)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(index); } }} className={styles.mapCell}>
        <title>{event.scientific.scan_id}: {valueText(event.scientific.value)} {event.scientific.unit}</title>
        <rect x={x} y={y} width={width} height={height} fill={selected ? "#b9f56d" : "transparent"} fillOpacity={selected ? 0.17 : 0} stroke={selected ? "#d2ff96" : "#ffffff55"} strokeWidth={selected ? 3 : 0.65} />
        {region && <circle cx={x + width / 2} cy={y + height / 2} r={selected ? 12 : 9} fill={selected ? "#d2ff96" : "#ffffff"} stroke="#071411" strokeWidth="2" />}
        <text x={x + width / 2} y={y + height / 2 + (region ? -21 : 5)} textAnchor="middle" fill={region ? "#ffffff" : selected ? "#e1ffbd" : "#ffffff"} fontSize={region ? 20 : 17} fontWeight={selected ? 700 : 400} paintOrder="stroke" stroke="#071411" strokeWidth="3">{event.scientific.scan_id}</text>
      </g>;
    })}
  </svg>;
}

export default function NotebookDemoPage() {
  const [contract, setContract] = useState<NotebookDemoContract | null>(null);
  const [error, setError] = useState("");
  const [pollutant, setPollutant] = useState<Pollutant>("pm25_rh35");
  const [dataMode, setDataMode] = useState<DataMode>("global");
  const [audioMode, setAudioMode] = useState<AudioMode>("scientific");
  const [direction, setDirection] = useState<Direction>("forward");
  const [cursor, setCursor] = useState(0);
  const [state, setState] = useState<DemoState>("ready");
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(55);
  const [blend, setBlend] = useState(100);
  const controller = useRef<NotebookDemoAudio | null>(null);

  useEffect(() => {
    const audio = new NotebookDemoAudio((event, fraction) => {
      setCursor(event.canonical_index); setProgress(fraction);
    }, setState);
    controller.current = audio;
    const abort = new AbortController();
    fetch("/data/notebook-demo/contract.json", { signal: abort.signal }).then(async res => {
      if (!res.ok) throw new Error("Không tải được dữ liệu demo.");
      const data = await res.json() as NotebookDemoContract;
      if (data.schema_version !== "breathe-notebook-demo-v1" || KEYS.some(key => data.global_plans?.[key]?.length !== 32 || data.region_plans?.[key]?.length !== 2)) throw new Error("Hợp đồng dữ liệu demo không hợp lệ.");
      setContract(data);
    }).catch(cause => { if (!abort.signal.aborted) setError(String(cause)); });
    return () => { abort.abort(); audio.dispose(); controller.current = null; };
  }, []);

  if (!contract) return <main className={styles.loading}><Globe2 size={42} /><h1>BREATHE / Listening lab</h1><p role={error ? "alert" : "status"}>{error || "Đang tải sáu trường khí quyển…"}</p><Link href="/">Về dashboard</Link></main>;

  const events = dataMode === "global" ? contract.global_plans[pollutant] : contract.region_plans[pollutant];
  const active = events[Math.min(cursor, events.length - 1)];
  const science = active.scientific, spec = contract.pollutants[pollutant];
  const span = contract.audio.seconds_per_bar;
  const snapshotTime = new Date(contract.source.timestamp_utc);
  const snapshotDate = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(snapshotTime).toUpperCase();
  const snapshotClock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(snapshotTime);
  const selection = (index: number, dir = direction) => dir === "forward" ? events.slice(index) : events.slice(0, index + 1).reverse();
  const run = async (index: number, dir = direction) => {
    setError("");
    try { await controller.current?.play(selection(index, dir), contract.audio); }
    catch (cause) { controller.current?.stop(); setError(`Không phát được âm thanh: ${cause instanceof Error ? cause.message : String(cause)}`); }
  };
  const seek = (index: number) => {
    const playing = state === "playing";
    controller.current?.stop(); setCursor(index); setProgress(0);
    if (playing) void run(index);
  };
  const reset = () => { controller.current?.stop(); setCursor(0); setProgress(0); setError(""); };
  const flip = () => {
    const next = direction === "forward" ? "reverse" : "forward";
    setDirection(next);
    if (state === "playing") void run(cursor, next);
    else if (state === "paused") controller.current?.stop();
    setProgress(0);
  };
  const play = () => {
    if (state === "playing") controller.current?.pause();
    else if (state === "paused") void controller.current?.resume().catch(cause => setError(String(cause)));
    else void run(cursor);
  };
  const coverage = science.total_cells ? science.valid_cells / science.total_cells : 0;
  const flatPulses = new Set(events.map(e => e.scientific.pulses)).size === 1;

  return <div className={styles.shell} lang="vi">
    <header className={styles.header}>
      <Link href="/" className={styles.brand}><AudioLines size={28} /><span>BREATHE<span className={styles.brandSub}>EARTH INFORMATION JUKEBOX</span></span></Link>
      <span className={styles.labBadge}>LISTENING LAB <span>01 / DEMO A</span></span>
      <Link href="/" className={styles.back}><ArrowLeft size={14} /> Dashboard</Link>
    </header>

    <main className={styles.main}>
      <div className={styles.intro}>
        <div><p className={styles.eyebrow}><span /> NASA GMAO · GEOS-CF v2</p><h1>Nhìn khí quyển.<br /><em>Nghe những khác biệt.</em></h1><p className={styles.description}>Sáu chất. Một thời điểm. Khám phá nồng độ qua các vùng và nghe cùng dữ liệu ở hai cách biểu diễn.</p></div>
        <div className={styles.snapshot}><span className={styles.eyebrow}>SNAPSHOT / UTC</span><strong>{snapshotDate}</strong><span>{snapshotClock} · {contract.source.grid_shape[0]} × {contract.source.grid_shape[1]} ô lưới</span><small><Check size={12} /> {contract.isMock ? "DỮ LIỆU MÔ PHỎNG / KHÔNG PHẢI NASA" : "GEOS-CF MODEL ANALYSIS"}</small></div>
      </div>

      <section aria-label="Chọn chất ô nhiễm" className={styles.pollutants}>
        {KEYS.map((key, index) => <button key={key} aria-pressed={pollutant === key} onClick={() => { reset(); setPollutant(key); }} className={pollutant === key ? styles.pollutantActive : ""}>
          <span className={styles.number}>0{index + 1}</span><strong>{SHORT_NAMES[index]}</strong><span>{contract.pollutants[key].unit}</span>
        </button>)}
      </section>

      <div className={styles.workspace}>
        <section className={styles.explorer} aria-label="Khám phá không gian">
          <div className={styles.sectionHeader}><div className={styles.tabs}>
            <button aria-pressed={dataMode === "global"} onClick={() => { reset(); setDataMode("global"); }}><Globe2 size={15} /> Global scan</button>
            <button aria-pressed={dataMode === "region"} onClick={() => { reset(); setDataMode("region"); }}>Region A / B</button>
            <button disabled title="Cần ít nhất hai timestamp NASA thật đã xác minh">Temporal <span>CHƯA ĐỦ DỮ LIỆU</span></button>
          </div><span className={styles.mono}>{dataMode === "global" ? "32 VÙNG / QUÉT ZÍC-ZẮC" : "HAI VÙNG MẪU VIỆT NAM"}</span></div>

          <div className={styles.mapFrame}>
            <div className={styles.mapTopline}><span>{spec.label} · {spec.unit}</span><span>90° N</span></div>
            <MapView events={events} active={active} image={contract.map_urls[pollutant]} onSelect={seek} />
            <div className={styles.mapBottomline}><span>180° W</span><div><i /> 0 <span className={styles.colorRamp} /> {spec.display_max} {spec.unit}</div><span>180° E</span></div>
          </div>
          <div className={styles.mapCaption}><span><span className={styles.greenDot} /> {science.scan_id} · {direction === "forward" ? "THUẬN" : "NGƯỢC"}</span><span>{dataMode === "global" ? "Bắc → Nam · các hàng đổi hướng Đông/Tây" : "A: vùng mẫu Hà Nội · B: vùng mẫu TP.HCM"}</span></div>

          <div className={styles.transport}>
            <div className={styles.transportButtons}>
              <button className={styles.play} onClick={play} aria-label={state === "playing" ? "Tạm dừng" : "Phát âm thanh"}>{state === "playing" ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button>
              <button onClick={() => { controller.current?.stop(); setProgress(0); }} aria-label="Dừng"><Square size={17} /></button>
              <span className={styles.divider} />
              <button disabled={cursor === 0} onClick={() => seek(cursor - 1)} aria-label="Vùng trước"><ChevronLeft size={19} /></button>
              <span className={styles.cursor}>{science.scan_id}<small>/ {events.length.toString().padStart(2, "0")}</small></span>
              <button disabled={cursor === events.length - 1} onClick={() => seek(cursor + 1)} aria-label="Vùng sau"><ChevronRight size={19} /></button>
            </div>
            <div className={styles.transportSecondary}><button onClick={reset} aria-label="Về đầu"><RotateCcw size={15} /></button><button onClick={flip} aria-pressed={direction === "reverse"}>{direction === "forward" ? <ArrowRight size={15} /> : <ArrowLeft size={15} />} {direction === "forward" ? "Thuận" : "Ngược"}</button><span className={styles.mono}>{span.toFixed(1)} s / vùng</span></div>
          </div>
          <div className={styles.progress} role="progressbar" aria-label="Tiến độ đoạn nghe" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress * 100}%` }} /></div>

          <div className={styles.scanHeading}><span className={styles.eyebrow}>{dataMode === "global" ? "CHỌN BẤT KỲ VÙNG NÀO ĐỂ TUA" : "CHỌN VÙNG ĐỂ SO SÁNH"}</span><span role="status">{state === "playing" ? "● Đang nghe" : state === "paused" ? "Ⅱ Tạm dừng" : "Sẵn sàng"}</span></div>
          <div className={dataMode === "global" ? styles.scanGrid : styles.regionGrid}>
            {events.map((event, index) => <button key={event.event_id} aria-pressed={cursor === index} onClick={() => seek(index)} aria-label={`${event.scientific.scan_id}, ${valueText(event.scientific.value)} ${spec.unit}, ${event.scientific.pulses ?? "thiếu"} xung`}>
              <span>{event.scientific.scan_id}</span><strong>{valueText(event.scientific.value)}</strong><small>{event.scientific.pulses === null ? "missing" : "●".repeat(event.scientific.pulses) || "—"}</small>
            </button>)}
          </div>
          <p className={styles.spatialNote}>Đây là tương phản <strong>không gian</strong> tại cùng một thời điểm, không phải diễn biến theo thời gian. Tua ngược giữ nguyên dữ liệu và nốt nhạc của từng vùng.</p>
        </section>

        <aside className={styles.details}>
          <section className={styles.readout}>
            <div className={styles.readoutHeader}><span className={styles.eyebrow}>SỰ KIỆN ĐANG CHỌN</span><span className={styles.eventBadge}>{science.scan_id}</span></div>
            <h2>{spec.label}</h2><div className={styles.value}>{valueText(science.value)}<span>{spec.unit}</span></div>
            <p>Trung bình vùng · trọng số cos(vĩ độ)</p>
            <div className={styles.scoreRow}><span>Điểm biểu diễn</span><strong>{science.score === null ? "—" : science.score.toFixed(4)}</strong></div>
            <div className={styles.scoreTrack}><span style={{ width: `${(science.score ?? 0) * 100}%` }} /></div>
            <div className={styles.pulseRow}>{Array.from({ length: 5 }, (_, i) => <span key={i} className={i < (science.pulses ?? 0) ? styles.pulseOn : ""} />)}<strong>{science.pulses === null ? "MISSING" : `${science.pulses} / 5 xung`}</strong></div>
            <dl className={styles.metrics}><div><dt>Thang âm thanh</dt><dd>0–{spec.audio_max} {spec.unit}</dd></div><div><dt>Ô hợp lệ</dt><dd>{science.valid_cells.toLocaleString("vi-VN")} / {science.total_cells.toLocaleString("vi-VN")}</dd></div><div><dt>Độ phủ dữ liệu</dt><dd>{(coverage * 100).toFixed(1)}%</dd></div><div><dt>Vĩ độ</dt><dd>{science.bounds.lat.join(" → ")}°</dd></div><div><dt>Kinh độ</dt><dd>{science.bounds.lon.join(" → ")}°</dd></div></dl>
          </section>

          <section className={styles.audioPanel} aria-label="Chế độ nghe">
            <div className={styles.panelTitle}><Headphones size={18} /><h2>Cùng dữ liệu. Hai cách nghe.</h2></div>
            <div className={styles.audioModes}>{(["scientific", "harmonic"] as const).map(mode => <button key={mode} aria-pressed={audioMode === mode} onClick={() => { setAudioMode(mode); controller.current?.setMode(mode); }}><strong>{mode === "scientific" ? "Scientific" : "Harmonic"}</strong><span>{mode === "scientific" ? "Chỉ lớp dữ liệu" : "Dữ liệu + hòa âm"}</span></button>)}</div>
            <p className={styles.audioExplanation}>{audioMode === "scientific" ? "Xung 440 Hz mã hóa nồng độ. Số xung thay đổi theo điểm biểu diễn; missing có hai xung thấp riêng." : "Giữ nguyên xung dữ liệu, thêm bass, hợp âm và giai điệu từ kế hoạch đã cố định."}</p>
            <div className={styles.chordCard}><div><span>ARTISTIC MOOD</span><strong>{active.artistic_mood ?? "MISSING"}</strong></div><div><span>CHORD</span><strong>{active.chord_name ?? "—"}</strong></div></div>
            <p className={styles.disclaimer}>Mood là diễn giải nghệ thuật, không phải AQI, cảnh báo sức khỏe hay độ bất định của mô hình.</p>
            <label className={styles.slider}><span><Volume2 size={14} /> Âm lượng <strong>{volume}%</strong></span><input aria-label="Âm lượng" type="range" min="0" max="100" value={volume} onChange={e => { const v = +e.target.value; setVolume(v); controller.current?.setVolume(v / 100); }} /></label>
            <label className={styles.slider}><span>Lớp nhạc <strong>{blend}%</strong></span><input aria-label="Mức lớp nhạc" type="range" min="0" max="100" value={blend} disabled={audioMode === "scientific"} onChange={e => { const v = +e.target.value; setBlend(v); controller.current?.setBlend(v / 100); }} /></label>
          </section>
        </aside>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      <section className={styles.learning} aria-label="Hướng dẫn diễn giải">
        <div><span>01 / SEE</span><h3>Giá trị trước cảm nhận.</h3><p>Bản đồ là trường nồng độ. Con số là trung bình vùng từ lưới gốc; thang màu không quyết định âm thanh.</p></div>
        <div><span>02 / HEAR</span><h3>{flatPulses ? "Cùng xung có thể khác số." : "Nghe xung, rồi nghe nhạc."}</h3><p>{flatPulses ? `Ở snapshot này, các vùng ${spec.label} có cùng ${science.pulses} xung. Nồng độ vẫn khác nhau; cách lượng tử hóa 5 mức đã làm mất chi tiết.` : "Số xung có năm mức nên không thể truyền mọi khác biệt số học. Tắt lớp nhạc để đối chiếu carrier."}</p></div>
        <div><span>03 / UNDERSTAND</span><h3>Mô hình, không phải trạm đo.</h3><p>GEOS-CF là phân tích mô hình. Các thang demo riêng cho từng chất không xếp hạng nguy hại giữa các chất.</p></div>
      </section>

      <details className={styles.provenance}><summary>Nguồn dữ liệu & giới hạn demo <span>+ TRACEABILITY</span></summary><div><p>{contract.source.provider} · {contract.source.collection} · {contract.source.timestamp_utc}</p><p>{contract.isMock ? "DỮ LIỆU MÔ PHỎNG — KHÔNG PHẢI NASA" : "Giá trị tính từ file GEOS-CF được cung cấp cùng notebook; SHA-256 khớp bản tham chiếu. Checksum xác nhận tính nhất quán, không thay thế xác minh nguồn tải."}</p><code>{contract.source.source_file}<br />SHA-256: {contract.source.sha256}</code>{contract.source.source_url && <a href={contract.source.source_url} target="_blank" rel="noreferrer">Nguồn NCCS ↗</a>}<p>Calibration: {contract.calibration_version}. Temporal chưa khả dụng: snapshot đóng gói chỉ có một timestamp đã đối chiếu. Hình do nhóm dựng từ GEOS-CF 2026, không phải frame SVS 5533 năm 2024.</p></div></details>
      <footer className={styles.footer}><span>BREATHE / EARTH INFORMATION JUKEBOX</span><span>Scientific integrity. Creative listening.</span></footer>
    </main>
  </div>;
}
