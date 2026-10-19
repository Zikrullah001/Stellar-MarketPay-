extern crate std;

use crate::*;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String};

fn create_dispute(
    env: &Env,
    client: &MarketPayContractClient<'_>,
    token_id: &Address,
    payer: &Address,
    index: u32,
) -> String {
    let freelancer = Address::generate(env);
    let job_id = match index {
        1 => String::from_str(&env, "dispute-1"),
        2 => String::from_str(&env, "dispute-2"),
        3 => String::from_str(&env, "dispute-3"),
        _ => String::from_str(&env, "dispute-other"),
    };
    client.create_escrow(
        &job_id,
        payer,
        &CreateEscrowParams {
            freelancer,
            token: token_id.clone(),
            amount: 100,
            milestones: None,
            timeout_ledgers: None,
            referrer: None,
        },
    );
    client.raise_dispute(&job_id, payer);
    job_id
}

fn setup_contract(env: &Env) -> (MarketPayContractClient<'_>, Address, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(MarketPayContract, ());
    let contract = MarketPayContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    contract.initialize(&admin, &treasury, &String::from_str(&env, "1.0.0"));
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let payer = Address::generate(env);
    token::StellarAssetClient::new(env, &token_id).mint(&payer, &1000);
    (contract, admin, token_id, payer)
}

#[test]
fn test_get_all_disputes_empty_state() {
    let env = Env::default();
    let (contract, _, _, _) = setup_contract(&env);

    let page = contract.get_all_disputes(&None, &10);

    assert!(page.disputes.is_empty());
    assert_eq!(page.next_cursor, None);
}

#[test]
fn test_get_all_disputes_respects_single_page_limit() {
    let env = Env::default();
    let (contract, admin, token_id, payer) = setup_contract(&env);
    let first_job = create_dispute(&env, &contract, &token_id, &payer, 1);
    create_dispute(&env, &contract, &token_id, &payer, 2);
    create_dispute(&env, &contract, &token_id, &payer, 3);

    let page = contract.get_all_disputes(&None, &2);

    assert_eq!(page.disputes.len(), 2);
    assert_eq!(page.disputes.get(0).unwrap().job_id, first_job);
    assert_eq!(page.next_cursor, Some(2));
}

#[test]
fn test_get_all_disputes_cursor_boundaries_across_pages() {
    let env = Env::default();
    let (contract, admin, token_id, payer) = setup_contract(&env);
    let first_job = create_dispute(&env, &contract, &token_id, &payer, 1);
    let second_job = create_dispute(&env, &contract, &token_id, &payer, 2);
    let third_job = create_dispute(&env, &contract, &token_id, &payer, 3);

    let first_page = contract.get_all_disputes(&None, &2);
    assert_eq!(first_page.next_cursor, Some(2));

    let second_page = contract.get_all_disputes(&first_page.next_cursor, &2);
    assert_eq!(second_page.disputes.len(), 1);
    assert_eq!(second_page.disputes.get(0).unwrap().job_id, third_job);
    assert_eq!(second_page.next_cursor, None);
    let resources = env.cost_estimate().resources();
    let budget = env.cost_estimate().budget();
    std::println!(
        "two-page dispute view: cpu_instructions={}, memory_bytes={}, resources={:?}",
        budget.cpu_instruction_cost(),
        budget.memory_bytes_cost(),
        resources
    );

    let boundary_page = contract.get_all_disputes(&Some(1), &2);
    assert_eq!(boundary_page.disputes.len(), 2);
    assert_eq!(boundary_page.disputes.get(0).unwrap().job_id, second_job);
    assert_eq!(boundary_page.disputes.get(1).unwrap().job_id, third_job);
    assert_eq!(boundary_page.next_cursor, None);
    assert_eq!(first_page.disputes.get(0).unwrap().job_id, first_job);
}

#[test]
#[should_panic(expected = "Unauthorized function call for address")]
fn test_get_all_disputes_requires_admin_auth() {
    let env = Env::default();
    let (contract, _, _, _) = setup_contract(&env);
    env.mock_auths(&[]);

    contract.get_all_disputes(&None, &10);
}
