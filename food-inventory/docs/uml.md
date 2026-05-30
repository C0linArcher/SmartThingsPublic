# FreshTrack — Food Inventory Management

UML domain model for **FreshTrack**, an inventory management system for a company
that sells food and food supplies. Food adds two concerns that generic inventory
systems ignore: **lot/batch traceability** and **expiration dates**. The model
below treats those as first-class.

## Class diagram

```mermaid
classDiagram
    direction LR

    class User {
        +UUID id
        +String name
        +String email
        +Role role
        +Boolean active
        +login(pw) Session
        +hasPermission(p) Boolean
    }

    class Supplier {
        +UUID id
        +String name
        +String contactEmail
        +String phone
        +String address
        +Int leadTimeDays
        +rating() Float
    }

    class Category {
        +UUID id
        +String name
        +UUID parentId
        +path() String
    }

    class Product {
        +UUID id
        +String sku
        +String name
        +String description
        +String barcode
        +UnitOfMeasure unit
        +Money unitPrice
        +Boolean perishable
        +Int shelfLifeDays
        +Int reorderPoint
        +Int reorderQty
        +StorageType storage
        +totalOnHand() Int
        +needsReorder() Boolean
    }

    class Warehouse {
        +UUID id
        +String name
        +String address
        +capacity() Int
    }

    class StorageZone {
        +UUID id
        +String label
        +StorageType type
        +Float minTempC
        +Float maxTempC
    }

    class StockBatch {
        +UUID id
        +String lotNumber
        +Date receivedDate
        +Date expirationDate
        +Int quantity
        +Money costPrice
        +daysUntilExpiry() Int
        +isExpired() Boolean
        +status() BatchStatus
    }

    class StockMovement {
        +UUID id
        +MovementType type
        +Int quantity
        +DateTime occurredAt
        +String reason
    }

    class PurchaseOrder {
        +UUID id
        +String poNumber
        +OrderStatus status
        +Date orderedAt
        +Date expectedAt
        +total() Money
        +receive(lines) void
    }

    class PurchaseOrderLine {
        +UUID id
        +Int quantity
        +Money unitCost
        +lineTotal() Money
    }

    class Customer {
        +UUID id
        +String name
        +String email
        +CustomerType type
    }

    class SalesOrder {
        +UUID id
        +String soNumber
        +OrderStatus status
        +Date placedAt
        +total() Money
        +fulfill() void
    }

    class SalesOrderLine {
        +UUID id
        +Int quantity
        +Money unitPrice
        +lineTotal() Money
    }

    class Alert {
        +UUID id
        +AlertType type
        +String message
        +Boolean acknowledged
        +DateTime createdAt
    }

    Category "1" o-- "0..*" Category : subcategories
    Category "1" --> "0..*" Product : classifies
    Supplier "1" --> "0..*" Product : supplies
    Warehouse "1" *-- "1..*" StorageZone : contains
    StorageZone "1" --> "0..*" StockBatch : stores
    Product "1" --> "0..*" StockBatch : tracked as
    StockBatch "1" --> "0..*" StockMovement : logs

    Supplier "1" --> "0..*" PurchaseOrder : receives
    PurchaseOrder "1" *-- "1..*" PurchaseOrderLine : contains
    PurchaseOrderLine "0..*" --> "1" Product : orders
    PurchaseOrder "1" ..> "0..*" StockBatch : produces on receipt

    Customer "1" --> "0..*" SalesOrder : places
    SalesOrder "1" *-- "1..*" SalesOrderLine : contains
    SalesOrderLine "0..*" --> "1" Product : sells
    SalesOrder "1" ..> "0..*" StockMovement : produces on fulfill

    Product "1" --> "0..*" Alert : raises
    StockBatch "1" --> "0..*" Alert : raises
    User "1" --> "0..*" PurchaseOrder : creates
    User "1" --> "0..*" StockMovement : performs
```

## Enumerations

```mermaid
classDiagram
    class Role {
        <<enumeration>>
        ADMIN
        WAREHOUSE_MANAGER
        PURCHASER
        SALES_CLERK
        VIEWER
    }
    class StorageType {
        <<enumeration>>
        AMBIENT
        REFRIGERATED
        FROZEN
    }
    class MovementType {
        <<enumeration>>
        RECEIPT
        SALE
        TRANSFER
        ADJUSTMENT
        WASTE_SPOILAGE
    }
    class BatchStatus {
        <<enumeration>>
        AVAILABLE
        EXPIRING_SOON
        EXPIRED
        QUARANTINED
        DEPLETED
    }
    class OrderStatus {
        <<enumeration>>
        DRAFT
        SUBMITTED
        PARTIALLY_RECEIVED
        RECEIVED
        CANCELLED
    }
    class AlertType {
        <<enumeration>>
        LOW_STOCK
        EXPIRING_SOON
        EXPIRED
        TEMPERATURE_BREACH
    }
```

## Key design decisions

- **Batch / lot tracking** — quantity lives on `StockBatch`, not `Product`. A
  product's on-hand total is the sum of its non-depleted batches. This is what
  enables expiry tracking, FEFO picking (First-Expired-First-Out), and recall
  traceability back to a supplier lot.
- **StockMovement as an immutable ledger** — every quantity change (receipt,
  sale, transfer, adjustment, spoilage) is an append-only event. Current stock is
  derivable from the ledger, which gives a full audit trail and explains *why*
  stock changed.
- **Storage zones with temperature ranges** — perishable goods must land in a
  zone whose `StorageType` matches the product. A breach raises a
  `TEMPERATURE_BREACH` alert.
- **Alerts** are generated for low stock (`onHand < reorderPoint`), near-expiry
  batches, and expired stock, driving the daily operational dashboard.
- **Orders produce inventory events** — receiving a `PurchaseOrder` creates
  `StockBatch` rows; fulfilling a `SalesOrder` consumes batches FEFO and writes
  `SALE` movements.
