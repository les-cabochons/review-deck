import * as React from "react";

/**
 * How to read a change diagram, in full, behind "How to read it". `concerns`: the map of a pull request's concerns in
 * Overview. `changes`: the map inside one concern in Files. `outline`: the same links as a list, on a phone.
 */
export const HowToRead: React.FC<{ kind: "concerns" | "changes" | "outline" }> = ({ kind }) => (
  <div className="how-to-read">
    {kind === "concerns" && (
      <>
        <h5>The cards</h5>
        <p>
          Each card is one concern of the guide, numbered in reading order, with how many changes it holds. <code>+41 −0</code> counts its added
          and removed lines, and the five squares show their share.
        </p>
        <h5>The columns and connectors</h5>
        <ul>
          <li>Concerns on the left define names. Each column to the right uses names from the columns before it.</li>
          <li>A connector joins a concern to one that uses it, with the arrowhead on the user's side. Arrowheads at both ends: each uses the other.</li>
          <li>The text over a connector is a name used. "+2" means two more names. Hover the connector to see them all.</li>
          <li>Concerns under "On their own" share no name with the others: they can be reviewed separately.</li>
        </ul>
      </>
    )}
    {kind === "changes" && (
      <>
        <h5>The cards</h5>
        <p>
          Each card is a function, or another declaration, that this concern changes. Below its name: its file, and how many separate changes the
          pull request makes inside it, when there is more than one. <code>+41 −0</code> counts its added and removed lines, and the five squares
          show their share.
        </p>
        <h5>The columns and connectors</h5>
        <ul>
          <li>Cards on the left define things. Each column to the right uses things from the columns before it.</li>
          <li>
            A connector joins a card to one that uses it, with the arrowhead on the user's side. From <code>sentence</code> to <code>make</code>:{" "}
            <code>make</code> calls <code>sentence</code>.
          </li>
          <li>The text over a connector is a name used. "+1" means one more name. Hover the connector to see them all.</li>
          <li>
            A name starting with a dot, like <code>.latestReport</code>, is a property or method used on an object.
          </li>
          <li>No text means the name used is the card's own name.</li>
        </ul>
        <h5>Reading it</h5>
        <ul>
          <li>Read from left to right: the left column doesn't depend on the other changes.</li>
          <li>A card many connectors arrive at is where the pieces come together: read it last.</li>
          <li>A card many connectors leave is something much of the change relies on: an error there spreads.</li>
          <li>Click a card to show only its changes, or a connector to show only the changes behind it. Click it again, or Show all, to see them all.</li>
          <li>"Other changes not linked" are in the diff below, but not in the map.</li>
        </ul>
      </>
    )}
    {kind === "outline" && (
      <>
        <h5>The list</h5>
        <ul>
          <li>Each block starts with a function, or another declaration, that uses others this concern changes, with its file and its added and removed lines.</li>
          <li>
            Under it, one row per thing it uses: the names used, then where they come from. A name starting with a dot, like{" "}
            <code>.latestReport</code>, is a property or method used on an object.
          </li>
          <li>Something two functions use shows under both.</li>
          <li>Tap a block's first row to show only its changes, or a row under it to show only the changes behind that link. Tap it again, or Show all, to see them all.</li>
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
