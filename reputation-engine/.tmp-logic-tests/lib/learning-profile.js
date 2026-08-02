"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEARNING_PROFILE_SCHEMA_VERSION = void 0;
exports.buildLeadLearningProfile = buildLeadLearningProfile;
exports.LEARNING_PROFILE_SCHEMA_VERSION = 1;
function includedInventory(lead) {
    return (lead.inventory || []).filter(item => item.included !== false);
}
function itemSource(item) {
    return String(item.source || 'unknown').toLowerCase();
}
function buildLeadLearningProfile(lead, quote) {
    const inventory = includedInventory(lead);
    const factors = lead.jobFactors || {};
    const inventorySources = Array.from(new Set(inventory.map(itemSource))).sort();
    const rooms = Array.from(new Set(inventory.map(item => item.room).filter(Boolean))).sort();
    const unknownDimensionCount = inventory.filter(item => !Number(item.cubicFeet) || !Number(item.weightLbs)).length;
    const hasAccessEvidence = Boolean(lead.originAccess ||
        lead.destAccess ||
        lead.parkingNotes ||
        factors.originParkingOk !== undefined ||
        factors.destParkingOk !== undefined);
    const hasInventoryEvidence = inventory.length > 0;
    const hasRoute = Boolean(lead.originAddress && lead.destAddress);
    const knownCoreFields = [
        Boolean(lead.moveDate),
        hasRoute,
        hasInventoryEvidence,
        hasAccessEvidence,
    ].filter(Boolean).length;
    return {
        schema_version: exports.LEARNING_PROFILE_SCHEMA_VERSION,
        captured_at: new Date().toISOString(),
        market: lead.branch || 'unassigned',
        acquisition: {
            source: lead.source || 'unknown',
            normalized_source: lead.attribution?.normalizedSource || null,
            campaign: lead.attribution?.utmCampaign || null,
            referral_named: Boolean(lead.referralCustomerName || lead.partnerReferralContactId || lead.partnerReferralName),
            realtor_linked: Boolean(lead.realtorContactId || lead.realtorEmail || lead.realtorPhone),
        },
        property: {
            type: lead.propertyType || null,
            bedrooms: lead.propertyBedrooms || null,
            listing_matched: Boolean(lead.supabaseListing),
            listing_inventory_scanned: Boolean(lead.listingScanSnapshot),
        },
        scope: {
            planning_scenario: factors.planningScenario || 'standard',
            quote_type: lead.quoteType || quote?.quoteType || 'standard',
            move_type: lead.moveType || quote?.moveType || 'residential',
            stop_count: Math.max(2, Number(lead.additionalStops || 0) + 2),
            inventory_items: inventory.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0),
            inventory_cubic_feet: Number(lead.totalCubicFeet || 0),
            inventory_weight_lbs: Number(lead.totalWeightLbs || 0),
            inventory_sources: inventorySources,
            room_count: rooms.length,
            unknown_dimension_count: unknownDimensionCount,
            conjoint: Boolean(factors.conjointMove),
            packing: lead.moveType === 'packing' || factors.packingStatus === 'not-started' || factors.packingStatus === 'partial',
            storage: factors.planningScenario === 'storage_staged' || lead.quoteType === 'storage',
            junk: factors.planningScenario === 'junk_addon',
            specialty: Boolean(factors.hasPiano || factors.hasSafe || factors.specialtyNotes),
        },
        operations: {
            access_known: hasAccessEvidence,
            origin_elevator: factors.originHasElevator ?? null,
            destination_elevator: factors.destHasElevator ?? null,
            origin_parking_known: factors.originParkingOk !== undefined,
            destination_parking_known: factors.destParkingOk !== undefined,
            crew_size: quote?.crewSize || factors.crewSizeOverride || null,
            truck_count: quote?.truckCount || factors.truckCountOverride || null,
            estimated_hours: quote?.estimatedHours || null,
        },
        customer_expressed: {
            priority: lead.customerPriority || null,
            move_reason: lead.moveReason || null,
        },
        evidence: {
            listing: Boolean(lead.supabaseListing || lead.listingScanSnapshot),
            customer_photo_survey: Boolean(lead.surveyCompletedAt || lead.surveyPhotoCount),
            video_survey: (lead.mediaAssets || []).some(asset => asset.kind === 'video' && !asset.removed),
            customer_inventory_confirmation: Boolean(lead.inventoryVerification?.completedAt),
        },
        confidence: {
            core_completion_pct: Math.round((knownCoreFields / 4) * 100),
            inventory_dimensions_complete: hasInventoryEvidence && unknownDimensionCount === 0,
            ready_for_binding_price: knownCoreFields === 4 && unknownDimensionCount === 0,
        },
        quote: quote ? {
            status: quote.status,
            subtotal: quote.subtotal,
            total: quote.total,
            deposit: quote.deposit,
            billing_model: quote.billingModel || null,
            discount_amount: quote.discountAmount || 0,
            revision_count: quote.changeLog?.length || 0,
        } : null,
    };
}
