import type { Metadata } from 'next';
import Link from 'next/link';

import { WCAG_TARGET } from '@/lib/wcag';

export const metadata: Metadata = { title: 'How AccessLens works' };

/*
 * What the tool is, how a run is made, and where its limits are.
 *
 * Every stage is labelled with what exists today. The project mockup shows the finished
 * product with illustrative data; this page must not, because a page in an accessibility tool
 * that overstates what the tool does is the same failure as a report that overstates a site.
 * The status words below are the ones to update as phases land.
 */

type Status = 'Built' | 'Partly built' | 'Planned';

const STAGES: { name: string; status: Status; does: string; today: string }[] = [
  {
    name: 'Crawler',
    status: 'Built',
    does: 'Finds the pages of a site, breadth first, within depth and page limits.',
    today:
      'Waits between requests, follows robots.txt (RFC 9309), checks every redirect hop before following it, and will not crawl beyond one page of a host that is not local until you confirm you have permission.',
  },
  {
    name: 'Parser',
    status: 'Built',
    does: 'Loads each page in real Chromium and records what the rules need.',
    today:
      'Four readers: the DOM, computed styles, the accessibility tree that screen readers are given, and a real keyboard walk that presses Tab through the page and checks whether focus is visible.',
  },
  {
    name: 'Rule engine',
    status: 'Built',
    does: 'One independent rule per WCAG success criterion, each deciding pass, fail or needs manual review.',
    today:
      'All twelve criteria in scope: 1.1.1, 1.3.1, 1.4.3, 1.4.11, 2.1.2, 2.4.1, 2.4.2, 2.4.4, 2.4.7, 3.1.1, 3.3.2 and 4.1.2. 1.3.1 is narrowed to lists, table headers, headings and radio groups. Every report lists exactly which rules ran, and at which version.',
  },
  {
    name: 'Scorer',
    status: 'Built',
    does: 'Groups findings into severity bands and compares runs.',
    today:
      'Severity bands per page and per site. Run-over-run change is computed by finding identity, in this dashboard and on the command line (accesslens diff compares two saved reports).',
  },
  {
    name: 'Reporter',
    status: 'Partly built',
    does: 'Turns findings into something a site owner can act on.',
    today:
      'A canonical JSON report, this dashboard, and an HTML and PDF report with a plain-language explanation for every criterion that has a problem, a line and column for each finding when a local HTML file is scanned, and an optional section on what changed since the previous run. Reviewable source patches are planned.',
  },
];

export default function AboutPage() {
  return (
    <div className="stack">
      <div className="stack-tight">
        <h1>How AccessLens works</h1>
        <p className="lede">
          AccessLens checks web pages against a defined subset of {WCAG_TARGET} success criteria
          that a machine can decide. It reports what it found in severity bands and never gives a
          score or claims a site conforms.
        </p>
      </div>

      <section aria-labelledby="pipeline-heading" className="stack-tight">
        <h2 id="pipeline-heading">The pipeline behind every run</h2>
        <p className="prose muted">
          Five stages, run in order. The same page always produces the same findings, byte for
          byte.
        </p>
        <ol className="pipeline">
          {STAGES.map((stage, index) => (
            <li key={stage.name} className="pipeline__stage sheet">
              <div className="sheet__body stack-tight">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3>
                    <span className="muted">{index + 1} · </span>
                    {stage.name}
                  </h3>
                  <span className="status-tag" data-status={stage.status}>
                    {stage.status}
                  </span>
                </div>
                <p className="small">{stage.does}</p>
                <p className="small muted">{stage.today}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="sheet">
          <div className="sheet__body stack-tight">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Language model layer (optional)</h3>
              <span className="status-tag" data-status="Built">
                Built (command line)
              </span>
            </div>
            <p className="small">
              On the command line, it rewrites findings the rules have already decided into plain
              explanations with a suggested fix, including draft alt text, shown in the HTML and PDF
              report as suggestions to review before use. Cached by finding identity, so the wording
              never changes between runs. It never detects a problem and never changes a band, and
              every report is complete with it switched off. Accepting, editing or rejecting a
              suggestion in this dashboard is not built yet.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="decisions-heading" className="stack-tight">
        <h2 id="decisions-heading">Three decisions that define the tool</h2>
        <div className="decisions">
          <article className="sheet">
            <div className="sheet__body stack-tight">
              <p className="xsmall muted">01 · No runtime overlay</p>
              <h3>Source fixes, not a JavaScript patch</h3>
              <p className="small">
                Assistive technology reads the page&rsquo;s own markup, and a script layered on top
                cannot repair structural barriers. AccessLens never injects anything into a live
                site; its output is findings, and later reviewable source changes.
              </p>
            </div>
          </article>
          <article className="sheet">
            <div className="sheet__body stack-tight">
              <p className="xsmall muted">02 · Deterministic detection</p>
              <h3>Only the rules decide</h3>
              <p className="small">
                Every finding comes from a rule running in a real browser. It is built from scratch
                rather than wrapping another checker, and its output is identical across runs of the
                same page, which is what makes comparing two runs meaningful.
              </p>
            </div>
          </article>
          <article className="sheet">
            <div className="sheet__body stack-tight">
              <p className="xsmall muted">03 · Honest boundaries</p>
              <h3>&ldquo;Cannot decide&rdquo; is an answer</h3>
              <p className="small">
                What a machine cannot judge is reported as <em>needs manual review</em>, never
                counted as a failure. A finding with no source file says so rather than guessing a
                line. No result is a statement that a site conforms.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section aria-labelledby="targets-heading" className="stack-tight">
        <h2 id="targets-heading">What each kind of target supports</h2>
        <p className="prose muted">
          Findings come from the rendered page, so any site that loads in Chromium can be checked.
          Pointing a finding at a line of source is only possible where that line exists.
        </p>
        <div className="sheet table-scroll">
          <table className="data-table">
            <caption className="visually-hidden">
              Whether findings and source locations are available for each kind of target
            </caption>
            <thead>
              <tr>
                <th scope="col">Target</th>
                <th scope="col">Findings</th>
                <th scope="col">Source location and patches</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Live URL (static HTML, server-rendered or client-rendered)</th>
                <td>Yes, today</td>
                <td>Not mapped today. Every current finding says so.</td>
              </tr>
              <tr>
                <th scope="row">Static HTML file on disk</th>
                <td>Yes, from the command line</td>
                <td>Yes: exact line and column (command line)</td>
              </tr>
              <tr>
                <th scope="row">Live URL with the repository available locally</th>
                <td>Planned</td>
                <td>Planned: best effort, only where one source element matches</td>
              </tr>
              <tr>
                <th scope="row">Client-rendered app (React, Vue, Angular)</th>
                <td>Yes, today</td>
                <td>Never: the element has no line of source. Findings and guidance only.</td>
              </tr>
              <tr>
                <th scope="row">Server-templated site (Django, PHP)</th>
                <td>Yes, today</td>
                <td>Not without instrumenting the templates</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <p className="prose small muted">
        Scans need a real browser, so they run from the command line, or from this dashboard when
        a scan service is connected to it; the dashboard never runs one itself. Either way, it
        stores, shows and compares the reports they produce. <Link href="/runs">Go to your runs</Link>.
      </p>
    </div>
  );
}
