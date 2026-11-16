import { Document, Page, Text, View } from "@react-pdf/renderer";
import { registerPdfFonts } from "@/lib/pdf/react-pdf-fonts";
import type { usageExportRows } from "@/lib/prepaid/usage-export";

const fontFamily = registerPdfFonts();

export function UsagePDF({
  name,
  rows,
}: {
  name: string;
  rows: ReturnType<typeof usageExportRows>;
}) {
  const showValue = rows[0]?.value !== undefined;
  return (
    <Document title={`Forbrugshistorik: ${name}`}>
      <Page
        size="A4"
        style={{ padding: 40, paddingBottom: 60, fontFamily, fontSize: 10 }}
      >
        <Text style={{ fontSize: 20, marginBottom: 8 }}>Forbrugshistorik</Text>
        <Text style={{ marginBottom: 20 }}>{name}</Text>
        <View
          fixed
          style={{
            flexDirection: "row",
            borderBottomWidth: 1,
            paddingBottom: 6,
          }}
        >
          <Text style={{ width: "20%" }}>Dato</Text>
          <Text style={{ width: "50%" }}>Beskrivelse</Text>
          <Text style={{ width: "15%" }}>Timer</Text>
          {showValue && <Text style={{ width: "15%" }}>Værdi (kr)</Text>}
        </View>
        {rows.map((row) => (
          <View
            key={row.id}
            style={{
              flexDirection: "row",
              paddingVertical: 6,
              borderBottomWidth: 0.5,
              borderBottomColor: "#dddddd",
            }}
          >
            <Text style={{ width: "20%" }}>{row.date}</Text>
            <Text style={{ width: "50%", paddingRight: 8 }}>
              {row.description}
            </Text>
            <Text style={{ width: "15%" }}>
              {row.hours.toLocaleString("da-DK", { minimumFractionDigits: 2 })}
            </Text>
            {showValue && (
              <Text style={{ width: "15%" }}>
                {row.value?.toLocaleString("da-DK", {
                  minimumFractionDigits: 2,
                })}
              </Text>
            )}
          </View>
        ))}
        <Text
          fixed
          style={{ position: "absolute", bottom: 25, right: 40 }}
          render={({ pageNumber, totalPages }) =>
            `${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}
