import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActionSdk, openReviewAction } from "../src/app/prMenuAction";

/** The SDK in a frame Azure DevOps just created: its context getters throw until `answer()` completes the handshake. */
function freshFrame() {
  let answered = false;
  let answer!: () => void;
  const ready = new Promise<void>((resolve) => (answer = resolve)).then(() => void (answered = true));
  const context = <T>(value: T) => () => {
    if (!answered) throw new Error("Attempted to call a context getter before init() was complete.");
    return value;
  };
  const sdk: ActionSdk = {
    ready: () => ready,
    getHost: context({ name: "nventive" }),
    getExtensionContext: context({ publisherId: "WepointCanada", extensionId: "review-deck" }),
    getWebContext: context({ project: { name: "Maintenance et Support" } }),
  };
  const visited: string[] = [];
  const action = openReviewAction(sdk, async () => ({ navigate: (url: string) => void visited.push(url) }));
  return { action, visited, answer };
}

test("Given the first click, which runs before the frame's handshake is answered, then the PR still opens in the Deck", async () => {
  const { action, visited, answer } = freshFrame();
  const clicked = action.execute({ pullRequest: { pullRequestId: 55618, repository: { id: "ff31877f", project: { name: "Maintenance et Support" } } } });
  answer();
  await clicked;
  assert.deepEqual(visited, ["https://dev.azure.com/nventive/Maintenance%20et%20Support/_apps/hub/WepointCanada.review-deck.review-hub?pr=55618&repo=ff31877f"]);
});

test("Given a page that passes only the ids, then the PR opens in the page's project; without them, nothing happens", async () => {
  const { action, visited, answer } = freshFrame();
  answer();
  await action.execute({ pullRequestId: 7, repositoryId: "r1" });
  await action.execute({});
  assert.deepEqual(visited, ["https://dev.azure.com/nventive/Maintenance%20et%20Support/_apps/hub/WepointCanada.review-deck.review-hub?pr=7&repo=r1"]);
});
