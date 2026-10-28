// Only an unambiguous affirmative may run the action. A phrase such as "yes but don't run it"
// must stay cancelled rather than matching just its first word.
export function confirmsVoiceAction(text: string): boolean {
  const heard = text.toLowerCase().replace(/[^\p{L}\s]/gu, "").replace(/\s+/g, " ").trim();
  return /^(yes|yes please|yeah|yep|yup|sure|ok|okay|go|go ahead|do it|run it|start it|please do|ja|confirm|po|po po|po bej|po bëj|beje|bëje|hajde|vazhdo|në rregull|ne rregull|patjetër|patjeter|sigurisht)$/.test(heard);
}
