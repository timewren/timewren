import { Document, Page, pdf, Text, View } from "@react-pdf/renderer";
import type { PersonalRecord } from "./records";

export async function recordsPDF(entries: PersonalRecord[], period: string) {
  return pdf(
    <Document title={`Mine registreringer ${period}`}>
      <Page size="A4" style={{ padding: 36, fontSize: 10 }}>
        <Text style={{ fontSize: 20, marginBottom: 12 }}>
          Mine registreringer: {period}
        </Text>
        <Text style={{ marginBottom: 12 }}>
          Timerne er vist uden afrunding.
        </Text>
        {entries.map((entry) => (
          <View
            key={entry.id}
            style={{
              marginBottom: 8,
              borderBottomWidth: 0.5,
              paddingBottom: 6,
            }}
          >
            <Text>
              {entry.date.toISOString().slice(0, 10)} ·{" "}
              {Number(entry.hours).toLocaleString("da-DK")} timer
            </Text>
            <Text>{entry.description ?? ""}</Text>
          </View>
        ))}
        <Text
          fixed
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
          style={{ position: "absolute", bottom: 20, right: 36 }}
        />
      </Page>
    </Document>,
  ).toBlob();
}
