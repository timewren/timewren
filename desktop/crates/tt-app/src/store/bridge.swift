// StoreKit 2-broen til App Store-udgaven (featuren `mas`, macOS 13+).
//
// build.rs oversætter filen med `swiftc` til et statisk bibliotek, når featuren
// er slået til på macOS; ellers bygges den ikke. Rust-siden er `src/store.rs`.
//
// Broen holder ingen tilstand ud over produkt-id'et og kaldet tilbage til
// Rust. Alt, der sker, sendes som én JSON-linje til `callback` (fra en
// vilkårlig tråd), og Rust-modellen afgør, hvad det betyder:
//
//   {"event":"product","id":…,"price":…}          produktet og dets lokaliserede pris
//   {"event":"product_missing","id":…}             App Store kender ikke produktet
//   {"event":"entitlement","id":…,"owned":bool}    verificeret køb, der gælder nu
//   {"event":"purchase","result":"success|pending|cancelled|unverified|failed","message":…}
//   {"event":"restore","result":"done|cancelled|failed","owned":bool,"message":…}
//   {"event":"error","op":"load","message":…}
//
// Licensen gælder kun for transaktioner, StoreKit selv har verificeret
// (`VerificationResult.verified`: Apples JWS-signatur, bundle-id og enhed).
// Der kaldes ingen server ud over App Store.

import Foundation
import StoreKit

public typealias TTStoreCallback = @convention(c) (UnsafePointer<CChar>) -> Void

private var callback: TTStoreCallback?
private var productID = ""
private var updates: Task<Void, Never>?

private func emit(_ fields: [String: Any]) {
    guard let cb = callback,
          let data = try? JSONSerialization.data(withJSONObject: fields),
          let line = String(data: data, encoding: .utf8)
    else { return }
    line.withCString { cb($0) }
}

/// Gælder et verificeret køb af produktet lige nu? Refunderede og
/// tilbagekaldte køb er ikke med i `currentEntitlements`.
private func owned(_ id: String) async -> Bool {
    for await result in Transaction.currentEntitlements {
        if case .verified(let tx) = result, tx.productID == id, tx.revocationDate == nil {
            return true
        }
    }
    return false
}

private func emitEntitlement(_ id: String) async {
    let has = await owned(id)
    emit(["event": "entitlement", "id": id, "owned": has])
}

private func loadProduct(_ id: String) async {
    do {
        if let p = try await Product.products(for: [id]).first {
            emit(["event": "product", "id": p.id, "price": p.displayPrice])
        } else {
            emit(["event": "product_missing", "id": id])
        }
    } catch {
        emit(["event": "error", "op": "load", "message": error.localizedDescription])
    }
}

/// Køb, der bliver færdige uden for appen (Spørg om lov, et udskudt køb,
/// en refusion, et køb på en anden enhed med samme Apple-konto).
private func listen(_ id: String) -> Task<Void, Never> {
    Task.detached {
        for await result in Transaction.updates {
            if case .verified(let tx) = result {
                await tx.finish()
            }
            await emitEntitlement(id)
        }
    }
}

@_cdecl("tt_store_start")
public func ttStoreStart(_ id: UnsafePointer<CChar>, _ cb: @escaping TTStoreCallback) {
    callback = cb
    productID = String(cString: id)
    let pid = productID
    updates?.cancel()
    updates = listen(pid)
    Task.detached {
        // Verificerede køb, appen ikke nåede at afslutte sidst.
        for await result in Transaction.unfinished {
            if case .verified(let tx) = result {
                await tx.finish()
            }
        }
        await emitEntitlement(pid)
        await loadProduct(pid)
    }
}

@_cdecl("tt_store_refresh")
public func ttStoreRefresh() {
    let pid = productID
    Task.detached {
        await emitEntitlement(pid)
        await loadProduct(pid)
    }
}

@_cdecl("tt_store_purchase")
public func ttStorePurchase() {
    let pid = productID
    Task.detached {
        do {
            guard let product = try await Product.products(for: [pid]).first else {
                emit(["event": "product_missing", "id": pid])
                emit(["event": "purchase", "result": "failed", "message": ""])
                return
            }
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                switch verification {
                case .verified(let tx):
                    await tx.finish()
                    emit(["event": "purchase", "result": "success", "message": ""])
                case .unverified(let tx, let err):
                    // Afsluttes, så det ikke kommer igen, men giver ingen licens.
                    await tx.finish()
                    emit(["event": "purchase", "result": "unverified", "message": err.localizedDescription])
                }
            case .pending:
                emit(["event": "purchase", "result": "pending", "message": ""])
            case .userCancelled:
                emit(["event": "purchase", "result": "cancelled", "message": ""])
            @unknown default:
                emit(["event": "purchase", "result": "failed", "message": ""])
            }
        } catch {
            emit(["event": "purchase", "result": "failed", "message": error.localizedDescription])
        }
        await emitEntitlement(pid)
    }
}

@_cdecl("tt_store_restore")
public func ttStoreRestore() {
    let pid = productID
    Task.detached {
        do {
            // Beder om Apple-kontoen og henter købene fra App Store.
            try await AppStore.sync()
            let has = await owned(pid)
            emit(["event": "restore", "result": "done", "owned": has, "message": ""])
        } catch StoreKitError.userCancelled {
            emit(["event": "restore", "result": "cancelled", "owned": false, "message": ""])
        } catch {
            emit(["event": "restore", "result": "failed", "owned": false, "message": error.localizedDescription])
        }
        await emitEntitlement(pid)
    }
}
