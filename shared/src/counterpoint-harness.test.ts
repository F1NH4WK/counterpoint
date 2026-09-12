import assert from "node:assert/strict";
import test from "node:test";

import {
  COUNTERPOINT_MAX_CANDIDATE_CHARACTERS,
  COUNTERPOINT_SESSION_INSTRUCTIONS,
  buildDraftResponseRequest,
  buildEvidenceQuery,
  buildSpeechResponseRequest,
  isFacilitatorActionAllowed,
  normalizeCounterpointDraft,
} from "./counterpoint-harness.js";

test("the harness makes draft generation separate from autonomous action", () => {
  assert.match(COUNTERPOINT_SESSION_INSTRUCTIONS, /not an autonomous meeting participant/i);
  assert.match(COUNTERPOINT_SESSION_INSTRUCTIONS, /explicit facilitator decision/i);

  const request = buildDraftResponseRequest();
  assert.equal(request.type, "response.create");
  assert.equal(request.response.conversation, "none");
  assert.deepEqual(request.response.output_modalities, ["text"]);
  assert.equal(request.response.tool_choice, "none");
  assert.match(request.response.instructions, /return only: PASS/i);
});

test("only concise, non-PASS drafts become candidates", () => {
  assert.equal(normalizeCounterpointDraft("  PASS.  "), undefined);
  assert.equal(normalizeCounterpointDraft("\n\t"), undefined);
  assert.equal(
    normalizeCounterpointDraft("Can we test the riskiest assumption before integrating?"),
    "Can we test the riskiest assumption before integrating?",
  );
  assert.equal(
    normalizeCounterpointDraft("x".repeat(COUNTERPOINT_MAX_CANDIDATE_CHARACTERS + 1)),
    undefined,
  );
});

test("speech and evidence require an opening plus explicit facilitator approval", () => {
  for (const action of ["speak", "research"] as const) {
    assert.equal(
      isFacilitatorActionAllowed(action, {
        gatePhase: "holding",
        hasCandidate: true,
        facilitatorApproved: true,
      }),
      false,
    );
    assert.equal(
      isFacilitatorActionAllowed(action, {
        gatePhase: "opening",
        hasCandidate: true,
        facilitatorApproved: false,
      }),
      false,
    );
    assert.equal(
      isFacilitatorActionAllowed(action, {
        gatePhase: "opening",
        hasCandidate: true,
        facilitatorApproved: true,
      }),
      true,
    );
  }
});

test("the speech request is bounded to the approved candidate and evidence is an app action", () => {
  const candidate = "What evidence would disprove this assumption in week one?";
  const speech = buildSpeechResponseRequest(candidate);

  assert.equal(speech.response.conversation, "none");
  assert.deepEqual(speech.response.output_modalities, ["audio"]);
  assert.equal(speech.response.tool_choice, "none");
  assert.equal(speech.response.input?.[0].content[0].text, candidate);
  assert.match(buildEvidenceQuery(candidate), /decision-relevant evidence/);
  assert.match(buildEvidenceQuery(candidate), /week one/);
  assert.throws(() => buildSpeechResponseRequest("PASS"), /needs a short, non-PASS candidate/);
});
