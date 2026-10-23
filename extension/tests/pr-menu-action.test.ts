import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActionSdk, keptUnlessFailed, openReviewAction } from "../src/app/prMenuAction";

/** The SDK in a frame Azure DevOps just created: its context getters throw until `answer()` completes the handshake. */
function freshFrame() {
  let answered = false;
  let answer!: () => void;
  const ready = new Promise<void>((resolve) => (answer = resolve)).then(() => void (answered = true));
  const afterHandshake = <T>(value: T) => () => {
    if (!answered) throw new Error("Attempted to call a context getter before init() was complete.");
    return value;
  };
  const sdk: ActionSdk = {
    ready: () => ready,
    getHost: afterHandshake({ name: "nventive" }),
    getExtensionContext: afterHandshake({ publisherId: "WepointCanada", extensionId: "review-deck" }),
    getWebContext: afterHandshake({ project: { name: "Maintenance et Support" } }),
  };
  const visited: string[] = [];
  const action = openReviewAction(sdk, async () => ({ navigate: (url: string) => void visited.push(url) }));
  return { action, visited, answer };
}

test("Given the first click, which runs before the frame's handshake is answered, then the PR still opens in the Deck", async () => {
  const { action, visited, answer } = freshFrame();
  const clicked = action.execute({ pullRequest: { pullRequestId: 55618, repository: { id: "ff31877f", project: { name: "Support" } } } });
  answer();
  await clicked;
  // In the PR's own project, which the menu passes, rather than the page's.
  assert.deepEqual(visited, ["https://dev.azure.com/nventive/Support/_apps/hub/WepointCanada.review-deck.review-hub?pr=55618&repo=ff31877f"]);
});

test("Given a page that passes only the ids, then the PR opens in the page's project; without them, nothing happens", async () => {
  const { action, visited, answer } = freshFrame();
  answer();
  await action.execute({ pullRequestId: 7, repositoryId: "r1" });
  await action.execute({});
  assert.deepEqual(visited, ["https://dev.azure.com/nventive/Maintenance%20et%20Support/_apps/hub/WepointCanada.review-deck.review-hub?pr=7&repo=r1"]);
});

test("Given asking for the host's navigation failed, then the next click asks again and opens the PR", async () => {
  const visited: string[] = [];
  let asks = 0;
  const navigation = keptUnlessFailed(async () => {
    if (++asks === 1) throw new Error("Service is not available");
    return { navigate: (url: string) => void visited.push(url) };
  });
  const sdk: ActionSdk = {
    ready: async () => {},
    getHost: () => ({ name: "nventive" }),
    getExtensionContext: () => ({ publisherId: "WepointCanada", extensionId: "review-deck" }),
    getWebContext: () => ({ project: { name: "Support" } }),
  };
  const action = openReviewAction(sdk, navigation);
  await assert.rejects(action.execute({ pullRequestId: 7, repositoryId: "r1" }));
  await action.execute({ pullRequestId: 7, repositoryId: "r1" });
  await action.execute({ pullRequestId: 8, repositoryId: "r1" });
  // Asked again once after the failure, then kept.
  assert.equal(asks, 2);
  assert.equal(visited.length, 2);
});
