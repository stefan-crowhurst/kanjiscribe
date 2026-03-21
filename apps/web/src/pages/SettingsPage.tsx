export function SettingsPage() {
  return (
    <section>
      <h2>Data Sources and Attribution</h2>
      <article className="card section-card">
        <h3>JMdict</h3>
        <p>
          Source:{' '}
          <a href="https://www.edrdg.org/jmdict/j_jmdict.html" target="_blank" rel="noreferrer">
            EDRDG JMdict_e
          </a>
          .
        </p>
        <p>License: CC BY-SA 4.0.</p>
        <p>URL: http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz</p>
      </article>

      <article className="card section-card">
        <h3>KANJIDIC2</h3>
        <p>
          Source:{' '}
          <a href="https://www.edrdg.org/kanjidic/kanjd2index_legacy.html" target="_blank" rel="noreferrer">
            EDRDG KANJIDIC2
          </a>
          .
        </p>
        <p>License: CC BY-SA 4.0.</p>
        <p>URL: http://www.edrdg.org/kanjidic/kanjidic2.xml.gz</p>
      </article>

      <article className="card section-card">
        <h3>KanjiVG</h3>
        <p>
          Source:{' '}
          <a href="https://kanjivg.tagaini.net/" target="_blank" rel="noreferrer">
            KanjiVG
          </a>{' '}
          release files.
        </p>
        <p>License: CC BY-SA 3.0.</p>
        <p>URL: https://github.com/KanjiVG/kanjivg/releases</p>
      </article>
    </section>
  );
}
