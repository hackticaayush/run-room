// /assets-test: every generated asset with its name, animations playing, plus the live UI kit.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BITMAP_FONTS,
  CHARACTERS,
  CHROME,
  CURSORS,
  FX,
  MOODS,
  PORTRAITS,
  PROPS,
  SHEETS,
  TILESET,
  UI_ICONS,
  assetUrl,
  type AtlasInfo,
  type CharacterKey,
  type ChromeName,
  type IconName,
} from '../assets/manifest';
import {
  CharacterFrame,
  PixelButton,
  PixelCheckbox,
  PixelIcon,
  PixelInput,
  PixelModal,
  PixelNumber,
  PixelPanel,
  PixelProgress,
  PixelScroll,
  PixelSprite,
  PixelTabs,
  PixelTextArea,
  Portrait,
  TileSprite,
  chromeImage,
  chromeStyle,
  type PixelScale,
} from '../ui';
import './assets-test.css';

/** Wall clock in ms, refreshed at about 20 FPS (enough for 4 to 8 FPS sprite animations). */
function useClock(): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 50);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Groups atlas frames named base_0, base_1 ... into animations. */
function groupFrames(atlas: AtlasInfo): { name: string; frames: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const name of Object.keys(atlas.frames)) {
    const m = /^(.*)_(\d+)$/.exec(name);
    const isAnim = m && (atlas.frames[`${m[1]}_0`] !== undefined && atlas.frames[`${m[1]}_1`] !== undefined);
    const key = isAnim && m ? m[1] : name;
    const list = groups.get(key) ?? [];
    list.push(name);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([name, frames]) => ({ name, frames }));
}

function Cell({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <figure className={`at-cell ${wide ? 'at-cell--wide' : ''}`}>
      <div className="at-cell-art">{children}</div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: ReactNode }) {
  return (
    <section id={id} className="at-section">
      <h2>
        {title}
        {count !== undefined && <span className="at-count"> ({count})</span>}
      </h2>
      <div className="at-grid">{children}</div>
    </section>
  );
}

function AnimatedAtlas({ atlas, frames, fps, scale, now }: { atlas: AtlasInfo; frames: string[]; fps: number; scale: PixelScale; now: number }) {
  const i = Math.floor((now / 1000) * fps) % frames.length;
  return <PixelSprite atlas={atlas} frame={frames[i]} scale={scale} />;
}

function CharacterAnim({ who, anim, now }: { who: CharacterKey; anim: keyof typeof CHARACTERS.animations; now: number }) {
  const a = CHARACTERS.animations[anim];
  const i = Math.floor((now / 1000) * a.fps) % a.frames.length;
  return <CharacterFrame who={who} frame={a.frames[i]} scale={3} />;
}

const SECTIONS = [
  ['tiles', 'TILES'],
  ['props', 'PROPS'],
  ['characters', 'CHARACTERS'],
  ['fx', 'FX'],
  ['icons', 'UI ICONS'],
  ['moods', 'MOOD FACES'],
  ['chrome', 'UI CHROME'],
  ['kit', 'UI KIT'],
  ['portraits', 'PORTRAITS'],
  ['fonts', 'FONTS'],
  ['sheets', 'SHEETS'],
] as const;

export function AssetsTest() {
  const now = useClock();
  const propGroups = useMemo(() => groupFrames(PROPS), []);
  const fxGroups = useMemo(() => groupFrames(FX), []);
  const iconNames = Object.keys(UI_ICONS.frames) as IconName[];
  const [tab, setTab] = useState<'one' | 'two' | 'three'>('one');
  const [check, setCheck] = useState(true);
  const [modal, setModal] = useState(false);
  const [text, setText] = useState('analyze samples/messy.py');
  const progress = (Math.sin(now / 900) + 1) / 2;

  return (
    <div className="at-page">
      <header className="at-head">
        <h1>RUN ROOM - ASSET TEST</h1>
        <nav className="at-nav">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
          <a href="/">-&gt; OFFICE</a>
        </nav>
      </header>
      <PixelScroll className="at-scroll">
        <main className="at-main">
          <Section id="tiles" title="TILES" count={Object.keys(TILESET.tiles).length}>
            {Object.entries(TILESET.tiles).map(([name, index]) => (
              <Cell key={name} label={`${index} ${name}`}>
                <TileSprite index={index} scale={3} />
              </Cell>
            ))}
          </Section>

          <Section id="props" title="PROPS" count={Object.keys(PROPS.frames).length}>
            {propGroups.map((g) => (
              <Cell key={g.name} label={g.frames.length > 1 ? `${g.name} (${g.frames.length}F)` : g.name}>
                <AnimatedAtlas atlas={PROPS} frames={g.frames} fps={g.name.startsWith('screen_code') ? 6 : 3} scale={2} now={now} />
              </Cell>
            ))}
          </Section>

          <Section id="characters" title="CHARACTERS">
            {(Object.keys(CHARACTERS.sheets) as CharacterKey[]).map((who) => (
              <div key={who} className="at-row">
                <Cell label={`${who}.png`} wide>
                  <img src={assetUrl(CHARACTERS.sheets[who])} width={96 * 2} height={120 * 2} alt={`${who} sheet`} />
                </Cell>
                {(Object.keys(CHARACTERS.animations) as (keyof typeof CHARACTERS.animations)[]).map((anim) => (
                  <Cell key={anim} label={`${who} ${anim}`}>
                    <CharacterAnim who={who} anim={anim} now={now} />
                  </Cell>
                ))}
              </div>
            ))}
          </Section>

          <Section id="fx" title="FX" count={Object.keys(FX.frames).length}>
            {fxGroups.map((g) => (
              <Cell key={g.name} label={g.frames.length > 1 ? `${g.name} (${g.frames.length}F)` : g.name}>
                <AnimatedAtlas atlas={FX} frames={g.frames} fps={4} scale={4} now={now} />
              </Cell>
            ))}
          </Section>

          <Section id="icons" title="UI ICONS, DIGITS, CURSORS" count={iconNames.length}>
            {iconNames.map((name) => (
              <Cell key={name} label={name}>
                <PixelIcon name={name} size={2} />
              </Cell>
            ))}
            {Object.entries(CURSORS).map(([name, c]) => (
              <Cell key={`file-${name}`} label={`${c.image} (hover)`}>
                <span
                  className="at-cursor-zone"
                  style={{ cursor: `url("${assetUrl(c.image)}") ${c.hotX} ${c.hotY}, default` }}
                >
                  <img src={assetUrl(c.image)} width={c.width} height={c.height} alt={name} />
                </span>
              </Cell>
            ))}
          </Section>

          <Section id="moods" title="MOOD FACES" count={Object.keys(MOODS.frames).length}>
            {Object.keys(MOODS.frames).map((name) => (
              <Cell key={name} label={name}>
                <PixelSprite atlas={MOODS} frame={name} scale={3} />
              </Cell>
            ))}
          </Section>

          <Section id="chrome" title="UI CHROME (9-SLICE)" count={Object.keys(CHROME).length}>
            {(Object.keys(CHROME) as ChromeName[]).map((name) => {
              const c = CHROME[name];
              return (
                <Cell key={name} label={`${name} slice ${c.slice.top}`}>
                  <div className="at-chrome-pair">
                    <span style={chromeImage(name, 3)} />
                    {!name.startsWith('checkbox') && <span className="at-chrome-stretch" style={chromeStyle(name, 2)} />}
                  </div>
                </Cell>
              );
            })}
          </Section>

          <section id="kit" className="at-section">
            <h2>UI KIT (LIVE COMPONENTS)</h2>
            <div className="at-kit">
              <PixelPanel title="PIXELPANEL" icon="terminal" actions={<PixelButton icon="close_x" aria-label="close" />}>
                <div className="at-kit-body">
                  <div className="at-kit-row">
                    <PixelButton label="DEFAULT" />
                    <PixelButton icon="play" label="WITH ICON" />
                    <PixelButton icon="fast_forward" label="ACTIVE" active />
                    <PixelButton icon="trash" label="DANGER" tone="danger" />
                    <PixelButton icon="lock" label="DISABLED" disabled />
                    <PixelButton icon="gear" aria-label="icon only" />
                    <PixelButton icon="clipboard_task" label="BIG BUTTON" size="lg" />
                  </div>
                  <div className="at-kit-row">
                    <PixelTabs
                      tabs={[
                        { id: 'one', label: 'ALL', icon: 'terminal' },
                        { id: 'two', label: 'GHOST' },
                        { id: 'three', label: 'BYTE' },
                      ]}
                      value={tab}
                      onChange={setTab}
                    />
                  </div>
                  <div className="at-kit-row at-kit-col">
                    <PixelProgress value={0} />
                    <PixelProgress value={0.35} />
                    <PixelProgress value={progress} />
                    <PixelProgress value={1} />
                    <div className="at-kit-row">
                      {[0, 1, 0.5, 0, 0, 0, 0].map((v, i) => (
                        <PixelProgress key={i} value={v} height={14} scale={1} style={{ width: 40 }} />
                      ))}
                    </div>
                  </div>
                  <div className="at-kit-row at-kit-col">
                    <PixelInput value={text} onChange={(e) => setText(e.target.value)} placeholder="TYPE HERE" />
                    <PixelTextArea rows={3} defaultValue={'Multi line input.\nNo default browser look.'} />
                  </div>
                  <div className="at-kit-row">
                    <PixelCheckbox checked={check} onChange={setCheck} label="PIXELCHECKBOX" />
                    <PixelCheckbox checked={false} onChange={() => {}} label="DISABLED" disabled />
                  </div>
                  <div className="at-kit-row">
                    <PixelNumber value={0} />
                    <PixelNumber value={7} />
                    <PixelNumber value={42} size={3} />
                    <PixelNumber value={1337} />
                    <PixelNumber value={Math.floor(now / 1000) % 1000} minDigits={3} />
                  </div>
                  <div className="at-kit-row">
                    <PixelButton icon="eye" label="OPEN PIXELMODAL" onClick={() => setModal(true)} />
                  </div>
                  <div className="at-kit-scrollbox">
                    <PixelScroll>
                      {Array.from({ length: 40 }, (_, i) => (
                        <div key={i} className="at-line">
                          {String(i).padStart(2, '0')} PIXELSCROLL LINE - DRAG THE THUMB OR USE THE WHEEL
                        </div>
                      ))}
                    </PixelScroll>
                  </div>
                </div>
              </PixelPanel>
            </div>
          </section>

          <Section id="portraits" title="PORTRAITS">
            {Object.keys(PORTRAITS).map((who) => (
              <Cell key={who} label={`portrait_${who}`}>
                <Portrait who={who as keyof typeof PORTRAITS} scale={3} />
              </Cell>
            ))}
          </Section>

          <Section id="fonts" title="BITMAP FONTS (CANVAS TEXT)">
            {Object.entries(BITMAP_FONTS).map(([role, f]) => (
              <Cell key={role} label={`${f.key} (${role})`} wide>
                <img src={assetUrl(f.image)} className="at-font" alt={f.key} style={{ width: 'auto', height: 'auto', zoom: 3 }} />
              </Cell>
            ))}
            <Cell label="HUD heading font" wide>
              <span className="px-head" style={{ fontSize: 16 }}>
                PRESS START 2P
              </span>
            </Cell>
            <Cell label="HUD body font" wide>
              <span style={{ fontSize: 28 }}>VT323 BODY AND TERMINAL TEXT 0123456789</span>
            </Cell>
          </Section>

          <Section id="sheets" title="CONTACT SHEETS AND PREVIEW">
            {Object.entries(SHEETS).map(([name, file]) => (
              <Cell key={name} label={file} wide>
                <a href={assetUrl(file)} target="_blank" rel="noreferrer">
                  <img src={assetUrl(file)} className="at-sheet" alt={name} />
                </a>
              </Cell>
            ))}
          </Section>
        </main>
      </PixelScroll>
      <PixelModal
        open={modal}
        title="PIXELMODAL"
        icon="warning_siren"
        onClose={() => setModal(false)}
        footer={
          <>
            <PixelButton label="CANCEL" onClick={() => setModal(false)} />
            <PixelButton icon="check_ok" label="OK" onClick={() => setModal(false)} />
          </>
        }
      >
        <p>Modal frame, header, close button and footer are all generated sprites.</p>
      </PixelModal>
    </div>
  );
}
