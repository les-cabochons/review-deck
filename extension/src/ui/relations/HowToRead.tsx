import * as React from "react";

/**
 * How to read a change diagram, in full, behind "How to read it". `concerns`: the map of a pull request's concerns in
 * Overview. `changes`: the map inside one concern in Files.
 */
export const HowToRead: React.FC<{ kind: "concerns" | "changes" }> = ({ kind }) => (
  <div className="how-to-read">
    {kind === "concerns" ? (
      <>
        <h5>The boxes</h5>
        <p>Each box is one concern of the guide, numbered in reading order, with how many changes it holds.</p>
        <h5>The arrows</h5>
        <ul>
          <li>An arrow from A to B means B uses a name that A defines or changes.</li>
          <li>Arrowheads at both ends mean each concern uses something from the other.</li>
          <li>The label is the name used. "+2" means two more names. Hover an arrow to see them all.</li>
          <li>Concerns under "On their own" share no name with the others: they can be reviewed separately.</li>
        </ul>
      </>
    ) : (
      <>
        <h5>The boxes</h5>
        <p>
          Each box is a function, or another declaration, that this concern changes. Below its name: its file, and how many separate changes the
          pull request makes inside it, when there is more than one.
        </p>
        <h5>The arrows</h5>
        <ul>
          <li>
            An arrow from A to B means B uses something A defines. <code>sentence → make</code> means <code>make</code> calls <code>sentence</code>.
          </li>
          <li>The label is the name B uses from A. "+1" means one more name. Hover an arrow to see them all.</li>
          <li>
            A name starting with a dot, like <code>.latestReport</code>, is a property or method used on an object.
          </li>
          <li>No label means the name used is the box's own name.</li>
        </ul>
        <h5>Reading it</h5>
        <ul>
          <li>Start with the boxes nothing points into: they don't depend on the other changes.</li>
          <li>Follow the arrows. A box many arrows point into is where the pieces come together: read it last.</li>
          <li>A box with many arrows going out is something much of the change relies on: an error there spreads.</li>
          <li>Click a box to show only its changes, or an arrow to show only the changes behind it. Click it again, or Show all, to see them all.</li>
          <li>"Other changes not linked" are in the diff below, but not in the map.</li>
        </ul>
      </>
    )}
    <h5>What it can't tell</h5>
    <p>
      Links come from matching names in the changed lines, not from what the code actually calls. Two different things with the same name can
      look linked; a name defined in the same file is preferred. Test files are left out. Names that match only as a property or method, on any
      object, aren't drawn.
    </p>
  </div>
);

/** "How to read it" and "Hide diagrams", beside a diagram's title. */
export const DiagramControls: React.FC<{ reading: boolean; onReading: (open: boolean) => void; onHide: () => void }> = ({ reading, onReading, onHide }) => (
  <span className="diagram-controls">
    <button className="link-button" aria-expanded={reading} onClick={() => onReading(!reading)}>
      {reading ? "Close the explanation" : "How to read it"}
    </button>
    <button className="link-button" onClick={onHide} title="Hide the change diagrams on every pull request. The settings menu (the gear) in Files brings them back.">
      Hide diagrams
    </button>
  </span>
);
