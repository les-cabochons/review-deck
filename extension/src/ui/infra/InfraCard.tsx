import * as React from "react";
import { blockTitle, isInfrastructure, needsLook, riskRank } from "../../../../src/infra/blocks";
import { showsModuleMap } from "../../../../src/infra/modules";
import type { InfraBlock } from "../../../../src/infra/types";
import type { InfraState } from "./useInfra";
import { Quoted, SummaryBadges, Verdict } from "./verdict";

const InfraDiagram = React.lazy(() => import("./InfraDiagram"));
const ModuleThumbnail = React.lazy(() => import("./ModuleMap").then((m) => ({ default: m.ModuleThumbnail })));
/** The card is a summary: the Infra tab has every block. */
const MAX_ROWS = 4;

/**
 * The Overview's summary of a pull request's Terraform changes: how many resources may be destroyed, replaced
 * or changed, the riskiest of them with the reason, and a thumbnail: of the module map when the pull request
 * changes several folders, of the one folder's diagram otherwise. The Infra tab says it is read from the code.
 */
export const InfraCard: React.FC<{ infra: InfraState; onOpen: () => void }> = ({ infra, onOpen }) => {
  if (!infra.present) return null;
  const { reading } = infra;
  const blocks = (reading?.modules ?? [])
    .flatMap((m) => m.blocks)
    .filter((b) => isInfrastructure(b) && needsLook(b))
    .sort((a, b) => riskRank(a) - riskRank(b) || a.address.localeCompare(b.address));
  return (
    <section className="infra-card" aria-label="Infrastructure changes">
      <header className="infra-card-head">
        <h3>Infrastructure</h3>
        {reading && <SummaryBadges modules={reading.modules} />}
        <button className="link-button" onClick={onOpen}>
          Open the Infra tab ›
        </button>
      </header>
      {infra.error ? (
        <p className="infra-card-note tone-error">Could not read the Terraform changes: {infra.error}</p>
      ) : !reading ? (
        <p className="infra-card-note muted">Reading the Terraform changes…</p>
      ) : (
        <>
          {blocks.length > 0 && (
            <div className="infra-card-body">
              <button className="infra-card-thumb" onClick={onOpen} title="Open the diagram" aria-label="Open the diagram in the Infra tab">
                <React.Suspense fallback={null}>
                  {showsModuleMap(reading.modules) ? <ModuleThumbnail modules={reading.modules} /> : <InfraDiagram module={reading.modules[0]} compact />}
                </React.Suspense>
              </button>
              <ul className="infra-card-rows">
                {blocks.slice(0, MAX_ROWS).map((block) => (
                  <li key={`${block.file}:${block.address}`}>
                    <Verdict block={block} />
                    <div>
                      <strong>{blockTitle(block).title}</strong> <code>{block.address}</code>
                      <div className="muted infra-card-why">
                        <Quoted text={why(block)} />
                      </div>
                    </div>
                  </li>
                ))}
                {blocks.length > MAX_ROWS && (
                  <li className="muted">
                    <span />
                    <button className="link-button" onClick={onOpen}>
                      and {blocks.length - MAX_ROWS} more
                    </button>
                  </li>
                )}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};

/** One line on a block: the reason for its risk, or which attributes changed. */
function why(block: InfraBlock): string {
  if (block.risk) return block.risk.reason;
  if (block.status === "added") return "New in this pull request.";
  if (block.status === "removed") return block.notes[0]?.text ?? "Removed from the code.";
  const paths = block.changes.map((c) => `\`${c.path}\``);
  return `${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""} changed.`;
}
