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
    status: 'Partly built',
    does: 'Loads each page in real Chromium and records what the rules need.',
    today:
      'The DOM and computed styles are extracted. The accessibility tree and keyboard focus order are not yet, so rules that need them do not run.',
  },
  {
    name: 'Rule engine',
    status: 'Partly built',
    does: 'One independent rule per WCAG success criterion, each deciding pass, fail or needs manual review.',
    today:
      'Rules are being added towards the twelve criteria in scope. Every report lists exactly which rules ran, and at which version.',
  },
  {
    name: 'Scorer',
    status: 'Built',
    does: 'Groups findings into severity bands and compares runs.',
    today:
      'Severity bands per page and per site. Run-over-run change is computed in this dashboard, by finding identity.',
  },
  {
    name: 'Reporter',
    status: 'Partly built',
    does: 'Turns findings into something a site owner can act on.',
    today:
      'A canonical JSON report, and this dashboard. HTML and PDF reports, and reviewable source patches, are planned.',
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
              <span className="status-tag" data-status="Planned">
                Planned
              </span>
            </div>
            <p className="small">
              Will rewrite findings that the rules have already decided into plain explanations,
              and draft alt text for a person to accept, edit or reject. Cached by finding
              identity, so the wording never changes between runs. It will never detect a problem
              and never change a band, and every report is complete with it switched off.
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
                <td>Planned</td>
                <td>Planned: exact line and column</td>
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
        Scans run from the command line, because they need a real browser. This dashboard stores,
        shows and compares the reports they produce. <Link href="/runs">Go to your runs</Link>.
      </p>
    </div>
  );
}
