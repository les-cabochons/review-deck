// "Open in Review Deck" entry in the pull request action menu: navigates to the review hub
// with the PR and repository ids as query parameters (app/prMenuAction.ts).
import { CommonServiceIds, type IHostNavigationService } from "azure-devops-extension-api";
import * as SDK from "azure-devops-extension-sdk";
import { openReviewAction } from "./app/prMenuAction";

// Asked for as soon as the handshake answers, so a click has it at hand.
const navigation = SDK.getService<IHostNavigationService>(CommonServiceIds.HostNavigationService);
navigation.catch(() => {}); // reported where awaited

SDK.register("open-review-action", openReviewAction(SDK, () => navigation));
SDK.init();
