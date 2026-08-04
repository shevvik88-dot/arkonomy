import Foundation
import Capacitor
import StoreKit

@objc(StorefrontPlugin)
public class StorefrontPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StorefrontPlugin"
    public let jsName = "Storefront"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCountryCode", returnType: CAPPluginReturnPromise)
    ]

    @objc func getCountryCode(_ call: CAPPluginCall) {
        Task {
            let countryCode = await AppStore.Storefront.current?.countryCode
            call.resolve(["countryCode": countryCode ?? ""])
        }
    }
}
