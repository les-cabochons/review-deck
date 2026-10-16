import * as React from "react";
import { FEATURE_NAMES, type Feature, type FeaturePolicy, locked } from "../data/access";

/** In place of a hub whose feature is off for this project. */
export const FeatureOff: React.FC<{ feature: Feature; policy: FeaturePolicy }> = ({ feature, policy }) => (
  <section className="startup-message" role="status">
    <h1>{FEATURE_NAMES[feature]} is turned off</h1>
    <p>
      {locked(policy)
        ? `Your organization has turned off the ${FEATURE_NAMES[feature]} for every project. An organization administrator can change it in Organization settings → Review Deck.`
        : `The ${FEATURE_NAMES[feature]} is off for this project. A project administrator can turn it on in Project settings → Review Deck.`}
    </p>
  </section>
);
