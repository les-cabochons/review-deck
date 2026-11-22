import * as React from "react";
import { blockTitle, needsLook, riskRank } from "../../../../src/infra/blocks";
import type { AttributeChange, InfraBlock, InfraModule } from "../../../../src/infra/types";
import type { InfraReading } from "../../review/infra";
import { cx, plural } from "../util";
import type { InfraState } from "./useInfra";
import { FromCode, Quoted, SummaryBadges, Verdict, verdict } from "./verdict";

const InfraDiagram = React.lazy(() => import("./InfraDiagram"));

/**
 * The Infra tab: per directory with changed Terraform files, a diagram of what changed and a list of every changed
 * block, riskiest first. Everything is read from the files (src/infra), and the tab says so up front, with what
 * that leaves out.
 */
export const InfraTab: React.FC<{ infra: InfraState }> = ({ infra }) => {
  if (infra.error)
    return (
      <div className="error-box" role="alert">
        Could not read the Terraform changes: {infra.error}
      </div>
    );
  if (!infra.reading) return <div className="loading">{infra.present ? "Reading the Terraform changes…" : "This comparison changes no Terraform files."}</div>;
  const { reading } = infra;
  return (
    <div className="infra-tab">
      <HowItWorks reading={reading} />
      {reading.modules.map((module, i) => (
        <ModuleSection key={module.dir} module={module} index={i} />
      ))}
    </div>
  );
};

/** What the view is read from and what it can't know, one line, with the details a click away. */
const HowItWorks: React.FC<{ reading: InfraReading }> = ({ reading }) => {
  const [open, setOpen] = React.useState(false);
  const sources = reading.replaceSources.map((s) => `${s.provider} ${s.version}`).join(", ");
  return (
    <div className="infra-source" role="note">
      <div className="infra-source-line">
        <span>Read from the changed .tf files. No terraform plan is attached, so a destroy or a replace here is a reading of the code, not what the provider will do.</span>
        <button className="link-button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide details" : "How this works"}
        </button>
      </div>
      {open && (
        <ul>
          <li>Review Deck parses both sides of every changed .tf and .tofu file in your browser. It never runs terraform, and reads no state, plan or variable values.</li>
          <li>
            <strong>Changed</strong> means the block's code changed. Comments and alignment don't count.
          </li>
          <li>
            <strong>Replace</strong> means an argument changed that the provider's documentation marks as forcing a new resource. The list comes from the {sources} documentation. Other providers have no list
            yet, so their replaces aren't flagged, and another provider version may behave differently. <em>Likely</em>: a literal value changed. <em>Possible</em>: only an expression changed, or the
            documentation states an exception.
          </li>
          <li>
            <strong>Destroy</strong> means a resource or module block is gone from the code, with no moved or removed block covering it.
          </li>
          <li>
            <strong>May follow</strong> means the resource uses one that may be destroyed or replaced. What the provider then does to it isn't in the code.
          </li>
          <li>Files the pull request doesn't change aren't read. A resource they declare shows as a grey neighbour, and a resource in them that uses a changed one isn't shown.</li>
          <li>What is inside a called module, how many instances count or for_each make, and what a variable evaluates to are not known.</li>
        </ul>
      )}
      {reading.skipped.length > 0 && <p className="tone-warning">Not read, because binary or too large: {reading.skipped.join(", ")}</p>}
    </div>
  );
};

const ModuleSection: React.FC<{ module: InfraModule; index: number }> = ({ module, index }) => {
  const rowId = (address: string) => `infra-${index}-${address}`;
  const [flash, setFlash] = React.useState<string | null>(null);
  const select = (address: string) => {
    const row = document.getElementById(rowId(address));
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "center" });
    setFlash(address);
  };
  React.useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [flash]);

  const listed = module.blocks.filter((b) => needsLook(b) || b.docsOnly).sort((a, b) => riskRank(a) - riskRank(b) || a.address.localeCompare(b.address));
  const sections: [string, InfraBlock[]][] = [
    ["Needs a look", listed.filter((b) => b.risk || b.notes.some((n) => n.level === "warn"))],
    ["Changed in the code", listed.filter((b) => !b.risk && !b.docsOnly && !b.notes.some((n) => n.level === "warn"))],
    ["Description only", listed.filter((b) => b.docsOnly)],
  ];
  return (
    <section className="infra-module" aria-label={`Terraform changes in ${module.dir || "the repository root"}`}>
      <header className="infra-module-head">
        <h3>{module.dir || "Repository root"}/</h3>
        <span className="muted">{plural(module.files.length, "changed file")}</span>
        <SummaryBadges modules={[module]} />
      </header>
      {module.parseErrors.length > 0 && (
        <p className="infra-parse-error tone-warning" role="alert">
          Could not fully parse {module.parseErrors.join(", ")}. Some of its blocks may be missing or wrong below.
        </p>
      )}
      <React.Suspense fallback={<div className="infra-diagram loading">Drawing the diagram…</div>}>
        <InfraDiagram module={module} onSelect={select} />
      </React.Suspense>
      <Legend />
      {sections.map(
        ([title, blocks]) =>
          blocks.length > 0 && (
            <div key={title} className="infra-list">
              <h4>
                {title} <span className="muted">{blocks.length}</span>
              </h4>
              <ul>
                {blocks.map((block) => (
                  <BlockRow key={block.address} block={block} id={rowId(block.address)} flash={flash === block.address} />
                ))}
              </ul>
            </div>
          ),
      )}
    </section>
  );
};

const Legend: React.FC = () => (
  <p className="infra-legend muted">
    <span className="infra-badge tone-destroy">− destroy</span>
    <span className="infra-badge tone-replace">−/+ replace</span>
    <span className="infra-badge tone-follows">−/+? may follow</span>
    <span className="infra-badge tone-changed">~ changed</span>
    <span className="infra-badge tone-added">+ added</span>
    <span>Grey box: unchanged neighbour.</span>
    <span>An arrow from A to B: B uses A. A coloured arrow: that reference was added, removed or rewritten.</span>
  </p>
);

/** Rows of a changed block's table shown before "Show all". */
const MAX_ATTRIBUTES = 8;
/** A heredoc or a long list would bury the table. The full text is in the Files tab. */
const MAX_VALUE = 240;

const BlockRow: React.FC<{ block: InfraBlock; id: string; flash: boolean }> = ({ block, id, flash }) => {
  const { tone, symbol } = verdict(block);
  const { title, subtitle } = blockTitle(block);
  // A changed block's table is the change itself. An added or removed block's is its whole body: a click away.
  const [open, setOpen] = React.useState(block.status === "changed");
  const [all, setAll] = React.useState(false);
  const statement = block.kind === "moved" || block.kind === "removed" || block.kind === "import";
  const shown = all ? block.changes : block.changes.slice(0, MAX_ATTRIBUTES);
  return (
    <li id={id} tabIndex={-1} className={cx("infra-row", `tone-${tone}`, flash && "flash")}>
      <div className="infra-row-head">
        <span className="infra-symbol" aria-hidden="true">
          {symbol}
        </span>
        <div className="infra-row-name">
          {statement ? (
            <code>{block.kind} block</code>
          ) : subtitle ? (
            <>
              <strong>{title}</strong> <code>{subtitle}</code>
            </>
          ) : (
            <code className="strong">{title}</code>
          )}
          {block.file && (
            <span className="muted infra-row-file">
              {block.file}
              {block.line ? `:${block.line}` : ""}
            </span>
          )}
        </div>
        <span className="infra-row-badges">
          <Verdict block={block} />
          {/* A risk that comes from a neighbour says nothing of the block's own edits, listed below. */}
          {block.risk?.kind === "follows" && block.status === "changed" && <span className="infra-badge tone-changed">changed</span>}
          {block.risk && <FromCode />}
        </span>
      </div>
      {block.risk && (
        <p className={cx("infra-reason", `tone-${tone}`)}>
          <Quoted text={block.risk.reason} />
        </p>
      )}
      {block.notes.map((note, i) => (
        <p key={i} className={cx("infra-note", note.level)}>
          <Quoted text={note.text} />
        </p>
      ))}
      {block.changes.length > 0 &&
        (open ? (
          <>
            <table className="infra-attributes">
              <thead>
                <tr>
                  <th>Attribute</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((change) => (
                  <tr key={change.path} className={cx(block.risk?.attributes?.includes(change.path) && "at-risk")}>
                    <td>{change.path}</td>
                    <Value text={change.before} side="before" />
                    <Value text={change.after} side="after" />
                  </tr>
                ))}
              </tbody>
            </table>
            {block.changes.length > MAX_ATTRIBUTES && !all && (
              <button className="link-button infra-more" onClick={() => setAll(true)}>
                Show all {block.changes.length} attributes
              </button>
            )}
          </>
        ) : (
          <button className="link-button infra-more" aria-expanded={false} onClick={() => setOpen(true)}>
            Show its {plural(block.changes.length, "attribute")}
          </button>
        ))}
    </li>
  );
};

const Value: React.FC<{ text: AttributeChange["before"]; side: "before" | "after" }> = ({ text, side }) =>
  text === null ? (
    <td className="none">not set</td>
  ) : (
    <td className={side} title={text.length > MAX_VALUE ? text : undefined}>
      {text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text}
    </td>
  );
