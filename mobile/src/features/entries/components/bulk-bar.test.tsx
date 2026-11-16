import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '~/lib/test-utils';
import { BulkBar } from './bulk-bar';

/**
 * Bundlinjen siger to ting: hvor mange poster der er samlet, og hvad trykket
 * på knappen gør. Den anden er den der kan lyve — på tre poster hvor én er
 * faktureret må den ikke tilbyde at fjerne en markering, de to andre ikke har.
 */

jest.mock('~/lib/i18n', () => ({ translate: (key: string) => key }));

const props = {
  count: 3,
  billedState: 'none' as const,
  busy: false,
  onMarkBilled: jest.fn(),
  onDelete: jest.fn(),
  onCancel: jest.fn(),
};

afterEach(cleanup);

describe('bulkBar', () => {
  it('forklarer hvad der skal til, før noget er valgt', () => {
    render(<BulkBar {...props} count={0} />);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('entries.bulk_empty');
  });

  it('deaktiverer handlingerne uden valgte poster', () => {
    render(<BulkBar {...props} count={0} />);
    expect(screen.getByTestId('bulk-billed')).toBeDisabled();
    expect(screen.getByTestId('bulk-delete')).toBeDisabled();
  });

  it('tæller den valgte mængde i flertal', () => {
    render(<BulkBar {...props} />);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('entries.bulk_count_other');
    expect(screen.getByTestId('bulk-billed')).toBeEnabled();
  });

  it('tæller én post i ental', () => {
    // Dansk har to pluralformer, og de står som hver sin nøgle, så den skal
    // vælges eksplicit — ellers får «1 valgt» staven fra «3 valgt».
    render(<BulkBar {...props} count={1} />);
    expect(screen.getByTestId('bulk-count')).toHaveTextContent('entries.bulk_count_one');
  });

  it('låser knapperne mens et kald er i luften', () => {
    // Et dobbelttryk må ikke fyre to `bulkDelete` — sletningen sker to gange,
    // og kvitteringen siger det samme to gange.
    render(<BulkBar {...props} busy />);
    expect(screen.getByTestId('bulk-delete')).toBeDisabled();
  });

  it('sætter markering på en blandet mængde', () => {
    render(<BulkBar {...props} billedState="mixed" />);
    expect(screen.getByTestId('bulk-billed')).toHaveTextContent('entries.actions.mark_billed');
  });

  it('fjerner markering når alle er fakturerede', () => {
    render(<BulkBar {...props} billedState="all" />);
    expect(screen.getByTestId('bulk-billed')).toHaveTextContent('entries.actions.unmark_billed');
  });

  it('kalder de tre handlinger', () => {
    render(<BulkBar {...props} />);
    fireEvent.press(screen.getByTestId('bulk-billed'));
    fireEvent.press(screen.getByTestId('bulk-delete'));
    fireEvent.press(screen.getByTestId('bulk-cancel'));
    expect(props.onMarkBilled).toHaveBeenCalledTimes(1);
    expect(props.onDelete).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});
