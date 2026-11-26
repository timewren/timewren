import { Document, Page, Text, View } from "@react-pdf/renderer";
import { toIntlLocale } from "@/i18n/format-locale";
import { registerPdfFonts } from "@/lib/pdf/react-pdf-fonts";
import type { usageExportRows } from "@/lib/prepaid/usage-export";

const fontFamily = registerPdfFonts();

export interface UsagePdfLanguage {
  locale: string;
  title: string;
  date: string;
  description: string;
  hours: string;
  value: string;
}

const danish: UsagePdfLanguage = {
  locale: "da",
  title: "Forbrugshistorik",
  date: "Dato",
  description: "Beskrivelse",
  hours: "Timer",
  value: "Værdi (kr)",
};

export function UsagePDF({
  name,
  rows,
  language = danish,
}: {
  name: string;
  rows: ReturnType<typeof usageExportRows>;
  language?: UsagePdfLanguage;
}) {
  const locale = toIntlLocale(language.locale);
  const showValue = rows[0]?.value !== undefined;
  return (
    <Document title={`${language.title}: ${name}`}>
      <Page
        size="A4"
        style={{ padding: 40, paddingBottom: 60, fontFamily, fontSize: 10 }}
      >
        <Text style={{ fontSize: 20, marginBottom: 8 }}>{language.title}</Text>
        <Text style={{ marginBottom: 20 }}>{name}</Text>
        <View
          fixed
          style={{
            flexDirection: "row",
            borderBottomWidth: 1,
            paddingBottom: 6,
          }}
        >
          <Text style={{ width: "20%" }}>{language.date}</Text>
          <Text style={{ width: "50%" }}>{language.description}</Text>
          <Text style={{ width: "15%" }}>{language.hours}</Text>
          {showValue && <Text style={{ width: "15%" }}>{language.value}</Text>}
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
              {row.hours.toLocaleString(locale, { minimumFractionDigits: 2 })}
            </Text>
            {showValue && (
              <Text style={{ width: "15%" }}>
                {row.value?.toLocaleString(locale, {
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
