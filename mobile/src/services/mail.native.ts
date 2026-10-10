import * as MailComposer from "expo-mail-composer";
import * as Linking from "expo-linking";
export async function openMail(to: string, subject: string, body: string) {
  if (await MailComposer.isAvailableAsync()) await MailComposer.composeAsync({ recipients: [to], subject, body });
  else {
    const uri = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (!await Linking.canOpenURL(uri)) throw new Error("Set up a mail app first. Your draft is still available here.");
    await Linking.openURL(uri);
  }
}
