import * as Linking from "expo-linking";
export async function openMail(to: string, subject: string, body: string) {
  await Linking.openURL(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
}
